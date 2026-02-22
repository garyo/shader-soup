/**
 * Shader Importer - Import shaders from zip files
 */

import JSZip from 'jszip';
import type { ShaderDefinition } from '@/types/core';
import type { ShaderExportMetadata } from './ShaderExporter';

export interface ImportResult {
  success: boolean;
  shaders: ShaderDefinition[];
  errors: string[];
}

export class ShaderImporter {
  /**
   * Import shaders from a zip file
   * @param file - Zip file to import
   * @returns Import result with imported shaders and any errors
   */
  public static async importFromZip(file: File): Promise<ImportResult> {
    const errors: string[] = [];
    const shaders: ShaderDefinition[] = [];

    try {
      const zip = await JSZip.loadAsync(file);

      // Check if this is a single shader export or multi-shader export
      const hasShaderFile = zip.file('shader.wgsl') !== null;

      if (hasShaderFile) {
        // Single shader export
        const shader = await this.extractShader(zip, '', errors);
        if (shader) {
          shaders.push(shader);
        }
      } else {
        // Multi-shader export - iterate through folders
        const folderNames = new Set<string>();
        zip.forEach((relativePath, _file) => {
          const parts = relativePath.split('/');
          if (parts.length > 1) {
            folderNames.add(parts[0]);
          }
        });

        for (const folderName of folderNames) {
          const shader = await this.extractShader(zip, folderName + '/', errors);
          if (shader) {
            shaders.push(shader);
          }
        }
      }

      return {
        success: shaders.length > 0,
        shaders,
        errors,
      };
    } catch (error) {
      errors.push(`Failed to read zip file: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        shaders: [],
        errors,
      };
    }
  }

  /**
   * Extract a single shader from a zip file
   * @param zip - JSZip instance
   * @param prefix - Path prefix for files (e.g., 'shader-name/')
   * @param errors - Array to collect errors
   * @returns Extracted shader or null if extraction failed
   */
  private static async extractShader(
    zip: JSZip,
    prefix: string,
    errors: string[]
  ): Promise<ShaderDefinition | null> {
    try {
      // Read shader source
      const shaderFile = zip.file(prefix + 'shader.wgsl');
      if (!shaderFile) {
        errors.push(`${prefix || 'Root'}: Missing shader.wgsl file`);
        return null;
      }
      const source = await shaderFile.async('text');

      // Read metadata
      const metadataFile = zip.file(prefix + 'metadata.json');
      let metadata: ShaderExportMetadata | null = null;
      if (metadataFile) {
        try {
          const metadataText = await metadataFile.async('text');
          metadata = JSON.parse(metadataText);
        } catch (error) {
          errors.push(`${prefix || 'Root'}: Failed to parse metadata.json`);
        }
      }

      // Create shader definition
      const shader: ShaderDefinition = {
        id: crypto.randomUUID(),
        name: metadata?.name || this.extractShaderName(prefix, source),
        cacheKey: crypto.randomUUID(), // Generate new cache key for imported shaders
        source,
        parameters: metadata?.parameters
          ? metadata.parameters.map(p => ({
              name: p.name,
              type: p.type,
              min: p.min,
              max: p.max,
              default: p.default,
              step: p.step ?? 0.01, // Default step if not provided
            }))
          : [],
        iterations: metadata?.iterations || 1,
        description: metadata?.description,
        createdAt: metadata?.createdAt ? new Date(metadata.createdAt) : new Date(),
        modifiedAt: metadata?.modifiedAt ? new Date(metadata.modifiedAt) : new Date(),
        changelog: metadata?.changelog,
      };

      return shader;
    } catch (error) {
      errors.push(`${prefix || 'Root'}: Failed to extract shader - ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Extract shader name from folder path or source code
   */
  private static extractShaderName(prefix: string, source: string): string {
    // Try to extract from folder name
    if (prefix) {
      const folderName = prefix.replace(/\/$/, '').split('/').pop();
      if (folderName) {
        // Convert from snake_case/kebab-case to Title Case
        return folderName
          .replace(/[_-]/g, ' ')
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
      }
    }

    // Try to extract from source code comments
    const nameMatch = source.match(/\/\/\s*@name\s+(.+)/);
    if (nameMatch) {
      return nameMatch[1].trim();
    }

    // Default name
    return 'Imported Shader';
  }

  /**
   * Validate that a file is a zip file
   */
  public static isZipFile(file: File): boolean {
    return file.type === 'application/zip' ||
           file.type === 'application/x-zip-compressed' ||
           file.name.endsWith('.zip');
  }
}
