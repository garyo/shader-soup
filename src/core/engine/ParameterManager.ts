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
   * Parse parameters from shader source code
   * Format: // @param name: min, max, default, step
   * Example: // @param frequency: 0.0, 10.0, 1.0, 0.1
   *
   * @param shaderSource - WGSL shader source code
   * @returns Array of parsed parameters
   */
  public parseParameters(shaderSource: string): ShaderParameter[] {
    const parameters: ShaderParameter[] = [];
    const paramRegex = /\/\/\s*@param\s+(\w+)\s*:\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)(?:\s*,\s*([\d.-]+))?/g;

    let match;
    while ((match = paramRegex.exec(shaderSource)) !== null) {
      const [, name, minStr, maxStr, defaultStr, stepStr] = match;

      const param: ShaderParameter = {
        name,
        min: parseFloat(minStr),
        max: parseFloat(maxStr),
        default: parseFloat(defaultStr),
        step: stepStr ? parseFloat(stepStr) : 0.01,
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
      parameterValues,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      'parameter-buffer'
    );
  }

  /**
   * Get parameter values as Float32Array
   * @param parameters - Shader parameters
   * @param values - Optional parameter values (defaults to default values)
   * @returns Float32Array with parameter values
   */
  public getParameterValues(
    parameters: ShaderParameter[],
    values?: Map<string, number>
  ): Float32Array {
    // Each f32 in WGSL, so array length = parameter count
    const array = new Float32Array(parameters.length);

    for (let i = 0; i < parameters.length; i++) {
      const param = parameters[i];
      const value = values?.get(param.name) ?? param.default;

      // Validate and clamp value
      const clampedValue = this.validateAndClampValue(value, param);
      array[i] = clampedValue;
    }

    return array;
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

    // Update buffer at offset (4 bytes per f32)
    const data = new Float32Array([clampedValue]);
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
