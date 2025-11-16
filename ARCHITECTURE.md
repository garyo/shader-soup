# Architecture

## System Overview

Evolve Image Gen is built as a modular, type-safe web application leveraging WebGPU for GPU-accelerated compute shader execution. The architecture separates concerns into distinct layers: core GPU operations, state management, UI components, and utilities.

```
┌─────────────────────────────────────────────────────────────┐
│                       UI Layer (SolidJS)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ ShaderGrid   │  │ ShaderEditor │  │ ImageUpload  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│                  State Layer (SolidJS Stores)                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ ShaderStore  │  │  InputStore  │  │  ResultStore │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│                      Core Layer                              │
│  ┌──────────────────────────────────────────────────┐       │
│  │            WebGPU Engine                          │       │
│  │  ┌─────────────┐  ┌─────────────┐               │       │
│  │  │   Shader    │  │   Buffer    │               │       │
│  │  │  Compiler   │  │  Manager    │               │       │
│  │  └─────────────┘  └─────────────┘               │       │
│  │  ┌─────────────┐  ┌─────────────┐               │       │
│  │  │  Pipeline   │  │  Executor   │               │       │
│  │  │  Builder    │  │             │               │       │
│  │  └─────────────┘  └─────────────┘               │       │
│  └──────────────────────────────────────────────────┘       │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │   Input      │  │   Output     │                        │
│  │  Processor   │  │  Processor   │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. WebGPU Engine (`src/core/engine/`)

The heart of the application, responsible for all GPU operations.

#### ShaderCompiler (`ShaderCompiler.ts`)
- **Responsibility**: Compile and validate WGSL shader code
- **Key Methods**:
  - `compile(source: string): Promise<GPUShaderModule>`
  - `validate(source: string): ValidationResult`
- **Error Handling**: Provides detailed compilation errors with line numbers

#### BufferManager (`BufferManager.ts`)
- **Responsibility**: Manage GPU memory allocation and data transfer
- **Key Methods**:
  - `createBuffer(descriptor: BufferDescriptor): GPUBuffer`
  - `writeToBuffer(buffer: GPUBuffer, data: ArrayBuffer): void`
  - `readFromBuffer(buffer: GPUBuffer): Promise<ArrayBuffer>`
- **Optimization**: Implements buffer pooling for frequently reused buffers

#### PipelineBuilder (`PipelineBuilder.ts`)
- **Responsibility**: Construct compute pipelines with appropriate bind groups
- **Key Methods**:
  - `createPipeline(shader: GPUShaderModule, layout: BindGroupLayout): GPUComputePipeline`
  - `createBindGroup(layout: BindGroupLayout, resources: Resource[]): GPUBindGroup`
- **Design**: Fluent API for pipeline construction

#### Executor (`Executor.ts`)
- **Responsibility**: Execute compute shaders and manage command queues
- **Key Methods**:
  - `execute(pipeline: ComputePipeline, workgroups: WorkgroupDimensions): Promise<void>`
  - `executeMultiple(pipelines: ComputePipeline[]): Promise<void>`
- **Concurrency**: Supports parallel execution of multiple independent shaders

#### WebGPUContext (`WebGPUContext.ts`)
- **Responsibility**: Initialize and manage WebGPU device and adapter
- **Key Methods**:
  - `initialize(): Promise<void>`
  - `getDevice(): GPUDevice`
  - `isSupported(): boolean`
- **Singleton Pattern**: Ensures single GPU context across application

#### ParameterManager (`ParameterManager.ts`)
- **Responsibility**: Manage shader parameters (uniforms) and their GPU buffers
- **Key Methods**:
  - `parseParameters(shaderSource: string): ShaderParameter[]`
  - `createParameterBuffer(params: ShaderParameter[]): GPUBuffer`
  - `updateParameter(buffer: GPUBuffer, name: string, value: number): void`
  - `getParameterValues(params: ShaderParameter[]): Float32Array`
- **Parameter Definition Format**:
  - Comment-based: `// @param name: min, max, default, step`
  - Example: `// @param frequency: 0.0, 10.0, 1.0, 0.1`
- **Validation**: Ensures parameter values stay within defined bounds

### 2. Input Processing (`src/core/input/`)

#### ImageProcessor (`ImageProcessor.ts`)
- **Responsibility**: Load, decode, and prepare images for GPU
- **Key Methods**:
  - `loadImage(source: File | URL): Promise<ImageData>`
  - `toGPUTexture(image: ImageData): GPUTexture`
  - `resizeImage(image: ImageData, dimensions: Dimensions): ImageData`
- **Formats**: Supports PNG, JPEG, WebP

#### CoordinateGenerator (`CoordinateGenerator.ts`)
- **Responsibility**: Generate normalized coordinate grids
- **Key Methods**:
  - `generateGrid(width: number, height: number): Float32Array`
  - `normalizeCoordinates(x: number, y: number, dimensions: Dimensions): [number, number]`
- **Coordinate System**:
  - X: -1.0 to 1.0 (left to right)
  - Y: Aspect-ratio scaled, centered at 0.0
  - Origin: Center of image

### 3. Output Processing (`src/core/output/`)

#### ResultRenderer (`ResultRenderer.ts`)
- **Responsibility**: Convert GPU output buffers to displayable images
- **Key Methods**:
  - `renderToCanvas(buffer: GPUBuffer, canvas: HTMLCanvasElement): void`
  - `bufferToImageData(buffer: GPUBuffer, dimensions: Dimensions): Promise<ImageData>`
- **Performance**: Uses OffscreenCanvas where supported

### 4. State Management (`src/stores/`)

Built with SolidJS stores for reactive state management.

#### ShaderStore (`shaderStore.ts`)
```typescript
interface ShaderStore {
  shaders: Map<string, ShaderDefinition>;
  activeShaders: Set<string>;
  parameterValues: Map<string, Map<string, number>>; // shaderId -> paramName -> value
  addShader(shader: ShaderDefinition): void;
  removeShader(id: string): void;
  updateShader(id: string, source: string): void;
  updateParameter(shaderId: string, paramName: string, value: number): void;
  getParameters(shaderId: string): ShaderParameter[];
}
```

#### InputStore (`inputStore.ts`)
```typescript
interface InputStore {
  currentImage: ImageData | null;
  imageSource: File | null;
  outputDimensions: Dimensions;
  setImage(image: File): Promise<void>;
  clearImage(): void;
}
```

#### ResultStore (`resultStore.ts`)
```typescript
interface ResultStore {
  results: Map<string, ShaderResult>;
  isProcessing: boolean;
  errors: Map<string, Error>;
  updateResult(shaderId: string, result: ImageData): void;
  clearResults(): void;
}
```

### 5. UI Components (`src/components/`)

#### ShaderGrid (`ShaderGrid.tsx`)
- **Purpose**: Display grid of shader results
- **Props**: `columns: number`, `results: ShaderResult[]`
- **Features**: Responsive grid layout, lazy loading

#### ShaderEditor (`ShaderEditor.tsx`)
- **Purpose**: Edit and manage individual shaders
- **Props**: `shader: ShaderDefinition`, `onUpdate: (source: string) => void`
- **Features**: Syntax highlighting, error display, real-time validation

#### ImageUpload (`ImageUpload.tsx`)
- **Purpose**: Upload and manage input images
- **Features**: Drag-and-drop, preview, format validation

#### ShaderCard (`ShaderCard.tsx`)
- **Purpose**: Display individual shader result with controls
- **Props**: `result: ShaderResult`, `onSelect?: () => void`
- **Features**: Fitness selection placeholder, metadata display, parameter controls

#### ParameterSlider (`ParameterSlider.tsx`)
- **Purpose**: Interactive slider for shader parameter control
- **Props**: `parameter: ShaderParameter`, `value: number`, `onChange: (value: number) => void`
- **Features**: Real-time value updates, min/max constraints, step increments, value display

#### ParameterPanel (`ParameterPanel.tsx`)
- **Purpose**: Container for all parameters of a shader
- **Props**: `shaderId: string`, `parameters: ShaderParameter[]`
- **Features**: Collapsible panel, grouped parameters, reset to defaults

## Data Flow

### Shader Execution Flow

```
User Input (Shader Code + Image)
         │
         ▼
  ┌──────────────┐
  │ UI Component │
  └──────┬───────┘
         │ (Update store)
         ▼
  ┌──────────────┐
  │ State Store  │
  └──────┬───────┘
         │ (Trigger execution)
         ▼
  ┌─────────────────────┐
  │  Input Processor    │
  │  - Load image       │
  │  - Generate coords  │
  └──────┬──────────────┘
         │
         ▼
  ┌─────────────────────┐
  │  WebGPU Engine      │
  │  - Compile shader   │
  │  - Create pipeline  │
  │  - Upload buffers   │
  │  - Execute compute  │
  │  - Read results     │
  └──────┬──────────────┘
         │
         ▼
  ┌─────────────────────┐
  │  Output Processor   │
  │  - Format output    │
  │  - Create ImageData │
  └──────┬──────────────┘
         │ (Update results)
         ▼
  ┌──────────────┐
  │ Result Store │
  └──────┬───────┘
         │ (Reactively update)
         ▼
  ┌──────────────┐
  │ UI Component │
  │ (Display)    │
  └──────────────┘
```

### Parameter Update Flow

```
User Adjusts Slider
         │
         ▼
  ┌──────────────────┐
  │ ParameterSlider  │
  │  (onChange)      │
  └──────┬───────────┘
         │
         ▼
  ┌──────────────────┐
  │  Shader Store    │
  │  - Update param  │
  │  - Trigger exec  │
  └──────┬───────────┘
         │
         ▼
  ┌──────────────────┐
  │ ParameterManager │
  │  - Validate      │
  │  - Update buffer │
  └──────┬───────────┘
         │
         ▼
  ┌──────────────────┐
  │  WebGPU Executor │
  │  - Re-execute    │
  │    shader        │
  └──────┬───────────┘
         │
         ▼
  ┌──────────────────┐
  │  Result Store    │
  │  (Update result) │
  └──────┬───────────┘
         │ (Reactive update)
         ▼
  ┌──────────────────┐
  │  ShaderCard      │
  │  (Display new    │
  │   result)        │
  └──────────────────┘
```

## Technical Decisions

### 1. WebGPU Compute Shaders vs Fragment Shaders

**Decision**: Use compute shaders exclusively

**Rationale**:
- Greater flexibility for arbitrary computations
- Not constrained by rasterization pipeline
- Better suited for non-rendering operations
- Future-proof for LLM-driven shader generation

### 2. SolidJS for State Management

**Decision**: Use SolidJS stores instead of external state libraries

**Rationale**:
- Fine-grained reactivity matches GPU update patterns
- Minimal bundle size
- Excellent TypeScript support
- Integrates seamlessly with Astro

### 3. Astro.js Framework

**Decision**: Use Astro with SolidJS islands

**Rationale**:
- Optimal loading performance (ship less JavaScript)
- SolidJS islands for interactive components
- Excellent TypeScript integration
- Build-time optimizations

### 4. Buffer Management Strategy

**Decision**: Implement manual buffer pooling

**Rationale**:
- Reduce GPU memory allocation overhead
- Critical for running N shaders efficiently
- Explicit control over GPU memory lifecycle

### 5. Error Handling

**Decision**: Multi-layer error handling with graceful degradation

**Layers**:
1. **WebGPU Layer**: Validation errors, compilation errors
2. **Store Layer**: State consistency errors
3. **UI Layer**: User-facing error messages

**Strategy**:
- Failed shaders don't block other executions
- Detailed error messages for debugging
- Fallback rendering for missing results

### 6. Shader Parameter Definition Format

**Decision**: Use comment-based parameter declarations in WGSL code

**Format**: `// @param name: min, max, default[, step]`

**Example**:
```wgsl
// @param frequency: 0.0, 10.0, 1.0, 0.1
// @param amplitude: 0.0, 2.0, 1.0, 0.05
// @param phase: 0.0, 6.28, 0.0, 0.1

struct Params {
  frequency: f32,
  amplitude: f32,
  phase: f32,
}

@group(0) @binding(2) var<uniform> params: Params;
```

**Rationale**:
- **LLM-Friendly**: Easy for LLMs to generate and modify parameter declarations
- **Self-Documenting**: Parameters are defined alongside shader code
- **Type-Safe**: Uniform struct enforces type consistency
- **Parser-Simple**: Regex-based parsing of comment annotations
- **UI Generation**: Automatic slider generation from metadata
- **Validation**: Min/max bounds enforced at parsing and runtime

**Alternative Considered**: Separate JSON/YAML parameter files
- **Rejected**: Adds complexity for LLM to manage multiple files
- **Rejected**: Breaks self-contained shader concept

## Testing Strategy

### Unit Tests
- **Core Engine**: Mock WebGPU interfaces
- **Input/Output Processors**: Test with known inputs
- **Stores**: Test state transitions

### Integration Tests
- **Shader Execution**: End-to-end with simple test shaders
- **Multi-shader Execution**: Verify parallel execution

### E2E Tests
- **User Flows**: Upload image, run shaders, view results
- **Browser Compatibility**: Test across WebGPU-enabled browsers

### Performance Tests
- **Benchmark**: Shader compilation, execution time
- **Memory**: GPU memory usage with N shaders
- **Concurrency**: Verify parallel execution efficiency

## Security Considerations

### Shader Code Execution
- WGSL is sandboxed by WebGPU specification
- No arbitrary code execution risks
- Future: Consider shader code size limits

### File Uploads
- Validate file types and sizes
- Client-side only processing (no server uploads initially)
- Sanitize file names

## Scalability

### Current Design (N shaders)
- Parallel execution of independent shaders
- Buffer pooling for memory efficiency
- Viewport virtualization for large grids

### Future Considerations (LLM Evolution)
- Worker threads for LLM inference
- IndexedDB for shader history
- WebRTC for distributed evaluation (multi-user fitness)

## Browser Compatibility

### Target Browsers
- Chrome/Edge 113+ (stable WebGPU)
- Firefox 118+ (WebGPU enabled)
- Safari 18+ (WebGPU support)

### Fallbacks
- Feature detection on load
- Clear error message if WebGPU unavailable
- Suggest compatible browsers

## Performance Goals

- **Shader Compilation**: < 100ms per shader
- **Execution (512x512 output)**: < 16ms per shader (60 FPS)
- **Multi-shader (10 shaders)**: Parallel execution within 200ms
- **UI Responsiveness**: Never block main thread > 16ms

## Future Architecture Extensions

### LLM Integration (Phase 2)
```
┌─────────────────────┐
│  LLM Service        │
│  ┌───────────────┐  │
│  │ Shader Mutator│  │
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ Evolution     │  │
│  │ Algorithm     │  │
│  └───────────────┘  │
└─────────────────────┘
```

### Fitness Tracking (Phase 2)
```
┌─────────────────────┐
│  Fitness Store      │
│  - User selections  │
│  - Ratings          │
│  - History          │
└─────────────────────┘
```
