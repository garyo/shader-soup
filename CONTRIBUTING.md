# Contributing to Evolve Image Gen

## Development Setup

### Prerequisites

- Bun v1.0 or higher
- Modern browser with WebGPU support (Chrome 113+, Firefox 118+, Safari 18+)

### Initial Setup

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Open http://localhost:4321 in your browser
```

## Development Workflow

### Running Tests

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test:watch

# Run tests with UI
bun test:ui
```

### Code Quality

```bash
# Type check
bun run typecheck

# Lint code
bun run lint

# Fix linting issues
bun run lint:fix

# Format code
bun run format

# Check formatting
bun run format:check
```

### Building for Production

```bash
# Build the project
bun run build

# Preview production build
bun run preview
```

## Project Structure

```
src/
├── components/         # SolidJS UI components
│   ├── base/          # Base/primitive components
│   └── ...            # Feature components
├── core/              # Core WebGPU and shader engine
│   ├── engine/        # WebGPU engine components
│   ├── input/         # Input processing
│   └── output/        # Output processing
├── stores/            # SolidJS state management
├── shaders/           # WGSL shader examples
│   └── examples/      # Example shaders
├── types/             # TypeScript type definitions
├── utils/             # Utility functions
└── pages/             # Astro pages

tests/
├── unit/              # Unit tests
├── integration/       # Integration tests
└── e2e/              # End-to-end tests
```

## Coding Standards

### TypeScript

- Use strict mode (already configured)
- Prefer explicit types over `any`
- Use const for immutable values
- Use arrow functions for consistency

### File Naming

- Components: PascalCase (e.g., `ShaderCard.tsx`)
- Utilities: camelCase (e.g., `formatError.ts`)
- Types: camelCase (e.g., `core.ts`)

### Testing

- Write tests for all new features
- Aim for >80% code coverage
- Use descriptive test names
- Group related tests in `describe` blocks

### Git Workflow

- Write clear, descriptive commit messages
- Keep commits focused and atomic
- Reference issues in commit messages when applicable

## Adding New Features

### WebGPU Engine Components

1. Create the component in `src/core/engine/`
2. Add TypeScript types in `src/types/`
3. Write unit tests in `tests/unit/core/engine/`
4. Update ARCHITECTURE.md if adding major components

### UI Components

1. Create component in `src/components/`
2. Add to appropriate store if state management needed
3. Write component tests
4. Ensure accessibility (ARIA labels, keyboard navigation)

### Shader Examples

1. Create shader in `src/shaders/examples/`
2. Document parameters using `// @param` comments
3. Add to shader library registry
4. Write integration test

## WebGPU Development

### Testing WebGPU Code

Since WebGPU is not available in test environments, mock the WebGPU API:

```typescript
// Example mock
const mockDevice = {
  createShaderModule: vi.fn(),
  createBuffer: vi.fn(),
  // ... other methods
};
```

### Debugging WebGPU

- Use Chrome DevTools > WebGPU tab
- Enable validation layers for detailed error messages
- Use `device.pushErrorScope()` and `device.popErrorScope()` for error handling

## Path Aliases

The project uses path aliases for cleaner imports:

- `@/*` → `src/*`
- `@components/*` → `src/components/*`
- `@core/*` → `src/core/*`
- `@stores/*` → `src/stores/*`
- `@types/*` → `src/types/*`
- `@utils/*` → `src/utils/*`
- `@shaders/*` → `src/shaders/*`

## Resources

- [Astro Documentation](https://docs.astro.build)
- [SolidJS Documentation](https://www.solidjs.com/docs/latest)
- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [WGSL Specification](https://www.w3.org/TR/WGSL/)
- [Vitest Documentation](https://vitest.dev)
