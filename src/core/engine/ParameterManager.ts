/**
 * Parameter Manager - Parse and manage shader parameters
 */

import { BufferManager } from './BufferManager';
import { ParameterValidationError } from '@/types/errors';
import type { ShaderParameter } from '@/types/core';
import { validateShaderParameter } from '@/types/core';

export class ParameterManager {
  private bufferManager: BufferManager;

  constructor(bufferManager: BufferManager) {
    this.bufferManager = bufferManager;
  }

  /**
   * Parse parameters from Params struct in shader source code
   *
   * New format (inline comments on struct fields):
   *   struct Params {
   *     frequency: f32,  // min=0.1, max=10.0, default=2.0, step=0.1
   *     amplitude: f32,  // min=0.0, max=5.0, default=1.0
   *   }
   *
   * Comments are optional. If not present, reasonable defaults are used:
   * - min: 0.0
   * - max: 10.0
   * - default: 1.0
   * - step: 0.01
   *
   * @param shaderSource - WGSL shader source code
   * @returns Array of parsed parameters
   */
  public parseParameters(shaderSource: string): ShaderParameter[] {
    const parameters: ShaderParameter[] = [];

    // Find the Params struct definition
    const structRegex = /struct\s+Params\s*\{([^}]+)\}/s;
    const structMatch = shaderSource.match(structRegex);

    if (!structMatch) {
      return parameters; // No Params struct found
    }

    const structBody = structMatch[1];
    console.log('[ParameterParser] Struct body:', structBody);

    // Parse each field in the struct
    // Match: fieldName: type, // optional comment with min=X, max=Y, default=Z, step=W
    // Support both f32 and i32 types
    const fieldRegex = /(\w+)\s*:\s*(f32|i32)\s*,?\s*(?:\/\/\s*(.*))?/g;

    let match;
    while ((match = fieldRegex.exec(structBody)) !== null) {
      const [, name, type, comment] = match;
      console.log('[ParameterParser] Found field:', name, 'type:', type, 'comment:', comment);

      // Default values
      let min = 0.0;
      let max = 10.0;
      let defaultValue = 1.0;
      let step = 0.01;

      // Parse inline comment if present
      if (comment) {
        const minMatch = comment.match(/min\s*=\s*([-\d.]+)/);
        const maxMatch = comment.match(/max\s*=\s*([-\d.]+)/);
        const defaultMatch = comment.match(/(?:default|def)\s*=\s*([-\d.]+)/);
        const stepMatch = comment.match(/step\s*=\s*([-\d.]+)/);

        if (minMatch) min = parseFloat(minMatch[1]);
        if (maxMatch) max = parseFloat(maxMatch[1]);
        if (defaultMatch) defaultValue = parseFloat(defaultMatch[1]);
        if (stepMatch) step = parseFloat(stepMatch[1]);
      }

      const param: ShaderParameter = {
        name,
        type: type as 'f32' | 'i32',
        min,
        max,
        default: defaultValue,
        step,
      };

      // Validate parameter
      const validation = validateShaderParameter(param);
      if (!validation.valid) {
        console.warn(`Invalid parameter ${name}:`, validation.errors);
        continue;
      }

      parameters.push(param);
    }

    return parameters;
  }

  /**
   * Parse iterations directive from shader source code
   * Format: // @iterations N
   * Example: // @iterations 10
   *
   * @param shaderSource - WGSL shader source code
   * @returns Number of iterations (default: 1)
   */
  public parseIterations(shaderSource: string): number {
    const iterationsRegex = /\/\/\s*@iterations\s+(\d+)/;
    const match = shaderSource.match(iterationsRegex);

    if (match) {
      const iterations = parseInt(match[1], 10);
      if (iterations > 0 && iterations <= 100) {
        return iterations;
      }
      console.warn(`Invalid iterations value ${iterations}, must be 1-100. Using 1.`);
    }

    return 1;
  }

  /**
   * Create a uniform buffer for parameters
   * @param parameters - Shader parameters
   * @param values - Optional parameter values (defaults to default values)
   * @returns GPU buffer containing parameter values
   */
  public createParameterBuffer(
    parameters: ShaderParameter[],
    values?: Map<string, number>
  ): GPUBuffer {
    const parameterValues = this.getParameterValues(parameters, values);

    // Create buffer with UNIFORM usage
    return this.bufferManager.createBufferWithData(
      parameterValues as BufferSource,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      'parameter-buffer'
    );
  }

  /**
   * Get parameter values as ArrayBuffer with proper types (f32 or i32)
   * @param parameters - Shader parameters
   * @param values - Optional parameter values (defaults to default values)
   * @returns ArrayBuffer with parameter values (each parameter is 4 bytes)
   */
  public getParameterValues(
    parameters: ShaderParameter[],
    values?: Map<string, number>
  ): ArrayBuffer {
    // Each parameter is 4 bytes (f32 or i32)
    const buffer = new ArrayBuffer(parameters.length * 4);
    const float32View = new Float32Array(buffer);
    const int32View = new Int32Array(buffer);

    for (let i = 0; i < parameters.length; i++) {
      const param = parameters[i];
      const value = values?.get(param.name) ?? param.default;

      // Validate and clamp value
      const clampedValue = this.validateAndClampValue(value, param);

      // Write as the appropriate type
      if (param.type === 'i32') {
        int32View[i] = Math.round(clampedValue);
      } else {
        float32View[i] = clampedValue;
      }
    }

    return buffer;
  }

  /**
   * Update a single parameter in a buffer
   * @param buffer - Parameter buffer
   * @param parameters - Shader parameters
   * @param name - Parameter name
   * @param value - New value
   */
  public updateParameter(
    buffer: GPUBuffer,
    parameters: ShaderParameter[],
    name: string,
    value: number
  ): void {
    // Find parameter index
    const index = parameters.findIndex((p) => p.name === name);

    if (index === -1) {
      throw new ParameterValidationError(`Parameter ${name} not found`, name);
    }

    const param = parameters[index];

    // Validate and clamp value
    const clampedValue = this.validateAndClampValue(value, param);

    // Update buffer at offset (4 bytes per parameter)
    // Use appropriate typed array based on parameter type
    const data = param.type === 'i32'
      ? new Int32Array([Math.round(clampedValue)])
      : new Float32Array([clampedValue]);
    this.bufferManager.writeToBuffer(buffer, data, index * 4);
  }

  /**
   * Update multiple parameters in a buffer
   * @param buffer - Parameter buffer
   * @param parameters - Shader parameters
   * @param values - Map of parameter names to values
   */
  public updateParameters(
    buffer: GPUBuffer,
    parameters: ShaderParameter[],
    values: Map<string, number>
  ): void {
    for (const [name, value] of values.entries()) {
      this.updateParameter(buffer, parameters, name, value);
    }
  }

  /**
   * Validate and clamp a parameter value
   * @param value - Value to validate
   * @param parameter - Parameter definition
   * @returns Clamped value
   */
  private validateAndClampValue(value: number, parameter: ShaderParameter): number {
    if (isNaN(value)) {
      console.warn(`Invalid value for parameter ${parameter.name}, using default`);
      return parameter.default;
    }

    // Clamp to min/max
    return Math.max(parameter.min, Math.min(parameter.max, value));
  }

  /**
   * Generate WGSL struct definition for parameters
   * @param parameters - Shader parameters
   * @returns WGSL struct code
   */
  public generateParameterStruct(parameters: ShaderParameter[]): string {
    if (parameters.length === 0) {
      return '';
    }

    const fields = parameters.map((param) => `  ${param.name}: f32,`).join('\n');

    return `struct Params {
${fields}
}`;
  }

  /**
   * Generate parameter documentation
   * @param parameters - Shader parameters
   * @returns Markdown documentation
   */
  public generateParameterDocs(parameters: ShaderParameter[]): string {
    if (parameters.length === 0) {
      return 'No parameters';
    }

    const rows = parameters.map(
      (param) =>
        `| ${param.name} | ${param.min} | ${param.max} | ${param.default} | ${param.step} |`
    );

    return `| Name | Min | Max | Default | Step |
|------|-----|-----|---------|------|
${rows.join('\n')}`;
  }

  /**
   * Serialize parameters to JSON
   * @param parameters - Shader parameters
   * @param values - Current parameter values
   * @returns JSON string
   */
  public serializeParameters(
    parameters: ShaderParameter[],
    values: Map<string, number>
  ): string {
    const data = parameters.map((param) => ({
      name: param.name,
      min: param.min,
      max: param.max,
      default: param.default,
      step: param.step,
      value: values.get(param.name) ?? param.default,
    }));

    return JSON.stringify(data, null, 2);
  }

  /**
   * Deserialize parameters from JSON
   * @param json - JSON string
   * @returns Map of parameter names to values
   */
  public deserializeParameters(json: string): Map<string, number> {
    const values = new Map<string, number>();

    try {
      const data = JSON.parse(json);

      if (Array.isArray(data)) {
        for (const param of data) {
          if (param.name && typeof param.value === 'number') {
            values.set(param.name, param.value);
          }
        }
      }
    } catch (error) {
      console.error('Failed to deserialize parameters:', error);
    }

    return values;
  }
}
