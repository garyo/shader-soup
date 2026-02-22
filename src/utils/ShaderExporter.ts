/**
 * Shader Exporter - Export shaders as zip files with code, metadata, and preview image
 */

import JSZip from 'jszip';
import type { ShaderDefinition } from '@/types/core';

export interface ShaderExportMetadata {
  name: string;
  description?: string;
  parameters: Array<{
    name: string;
    type: 'f32' | 'i32';
    min: number;
    max: number;
    default: number;
    step?: number;
  }>;
  iterations?: number;
  createdAt: string;
  modifiedAt: string;
  changelog?: string;
}

export class ShaderExporter {
  /**
   * Export a single shader as a zip file
   * @param shader - Shader to export
   * @param imageDataUrl - Data URL of rendered preview image
   */
  public static async exportShader(
    shader: ShaderDefinition,
    imageDataUrl?: string
  ): Promise<void> {
    const zip = new JSZip();

    // Add shader source code
    zip.file('shader.wgsl', shader.source);

    // Add metadata
    const metadata: ShaderExportMetadata = {
      name: shader.name,
      description: shader.description,
      parameters: shader.parameters.map(p => ({
        name: p.name,
        type: p.type,
        min: p.min,
        max: p.max,
        default: p.default,
        step: p.step,
      })),
      iterations: shader.iterations,
      createdAt: shader.createdAt.toISOString(),
      modifiedAt: shader.modifiedAt.toISOString(),
      changelog: shader.changelog,
    };
    zip.file('metadata.json', JSON.stringify(metadata, null, 2));

    // Add preview image if available
    if (imageDataUrl) {
      // Convert data URL to blob
      const response = await fetch(imageDataUrl);
      const blob = await response.blob();
      zip.file('preview.png', blob);
    }

    // Generate zip and download
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.sanitizeFilename(shader.name)}.zip`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Export multiple shaders as a single zip file
   * @param shaders - Array of shaders to export
   * @param imageDataUrls - Map of shader IDs to image data URLs
   */
  public static async exportAllShaders(
    shaders: ShaderDefinition[],
    imageDataUrls?: Map<string, string>
  ): Promise<void> {
    const zip = new JSZip();

    // Create a folder for each shader
    for (const shader of shaders) {
      const folderName = this.sanitizeFilename(shader.name);
      const folder = zip.folder(folderName);

      if (!folder) continue;

      // Add shader source code
      folder.file('shader.wgsl', shader.source);

      // Add metadata
      const metadata: ShaderExportMetadata = {
        name: shader.name,
        description: shader.description,
        parameters: shader.parameters.map(p => ({
          name: p.name,
          type: p.type,
          min: p.min,
          max: p.max,
          default: p.default,
          step: p.step,
        })),
        iterations: shader.iterations,
        createdAt: shader.createdAt.toISOString(),
        modifiedAt: shader.modifiedAt.toISOString(),
        changelog: shader.changelog,
      };
      folder.file('metadata.json', JSON.stringify(metadata, null, 2));

      // Add preview image if available
      const imageDataUrl = imageDataUrls?.get(shader.id);
      if (imageDataUrl) {
        const response = await fetch(imageDataUrl);
        const blob = await response.blob();
        folder.file('preview.png', blob);
      }
    }

    // Generate zip and download
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    const timestamp = new Date().toISOString().split('T')[0];
    link.download = `shaders-export-${timestamp}.zip`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Sanitize filename for safe file system usage
   */
  private static sanitizeFilename(name: string): string {
    return name
      .replace(/[^a-z0-9_-]/gi, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
  }
}
