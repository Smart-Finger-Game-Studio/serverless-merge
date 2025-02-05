# serverless-merge
[![npm version](https://badge.fury.io/js/%40smartfinger%2Fserverless-merge.svg)](https://www.npmjs.com/package/@smartfinger/serverless-merge)

Advanced serverless configuration merger with nested file support, section-based imports, and multi-file processing capabilities. Supports both `.yml` and `.yaml` files.

## Why?
Serverless Framework provides basic file importing capabilities but lacks advanced merge strategies. This tool enables:
- Merging multiple configuration files
- Section-based imports
- List merging
- Intelligent backup & restore
- Multi-file processing
- Pattern-based file matching
- Support for both .yml and .yaml files

## Installation

```bash
npm install --save-dev @smartfinger/serverless-merge
```

## Usage

### Basic Command Line Usage
```bash
# Basic usage with yml
npx serverless-merge -i serverless.yml

# Basic usage with yaml
npx serverless-merge -i template.yaml

# With output file
npx serverless-merge -i serverless.yml -o serverless-merged.yml

# Restore from backup
npx serverless-merge --restore
```

### Advanced Command Line Usage
```bash
# Bulk process all yaml files in a directory
npx serverless-merge --bulk --input ./stacks

# Process specific yaml files using pattern
npx serverless-merge --bulk --pattern "*.yaml"

# Process multiple inputs
npx serverless-merge --bulk --input ./stacks --input ./template.yaml

# Bulk restore with pattern matching
npx serverless-merge --bulk --restore --pattern "*.yaml"

# Process multiple directories and files
npx serverless-merge --bulk --input ./stacks --input ./config --input ./template.yaml
```

### NPM Scripts Integration
Add to your package.json:
```json
{
  "scripts": {
    "merge:simple": "serverless-merge -i serverless.yml",
    "merge:restore": "serverless-merge --restore",
    
    "merge:stack": "serverless-merge --bulk --input ./stacks --input ./template.yaml --pattern \"*.yaml\"",
    "merge:stack:restore": "serverless-merge --bulk --restore --input ./stacks --input ./template.yaml --pattern \"*.yaml\"",
    
    "pre:deploy": "npm run merge:stack",
    "post:deploy": "npm run merge:stack:restore"
  }
}
```

### Merge Strategies

1. **Direct Merge**
```yaml
provider:
  merge: ${file(config/provider.yml)}
```

2. **Alternative Syntax**
```yaml
custom:
  $<<: ${file(config/custom.yml)}
```

3. **List Merge**
```yaml
functions:
  merge:
    - ${file(functions/auth.yml)}
    - ${file(functions/api.yml)}
```

4. **Section Merge**
```yaml
resources:
  Resources:
    merge: ${file(resources.yml):Resources}
  Outputs:
    merge: ${file(resources.yml):Outputs}
```

5. **Pack Merge (Alternative)**
```yaml
resources:
  merge:pack: ${file(resources.yml)}
```

### Project Structure Examples

#### Simple Project
```
.
├── serverless.yml
├── config/
│   ├── provider.yml
│   └── custom.yml
├── functions/
│   ├── auth.yml
│   └── api.yml
└── resources/
    └── resources.yml
```

#### Advanced Multi-Stack Project
```
.
├── template.yaml
├── stacks/
│   ├── api.yaml
│   ├── functions.yaml
│   ├── permissions.yaml
│   └── resources.yaml
├── config/
│   ├── common.yaml
│   └── environment.yaml
└── src/
    └── functions/
        ├── auth.yaml
        └── api.yaml
```

### Programmatic Usage

```javascript
const { YamlMerger } = require('@smartfinger/serverless-merge');

async function mergeConfigs() {
  const merger = new YamlMerger({ logLevel: 'info' });
  
  try {
    // Single file processing
    await merger.process('template.yaml');
    
    // Bulk processing
    await merger.bulkProcess('./stacks', '*.yaml');
    
    // Your deployment logic here
    
    // Bulk restore
    await merger.bulkRestore('./stacks', '*.yaml');
    
    // Single file restore
    await merger.restore('template.yaml');
  } catch (error) {
    console.error('Operation failed:', error);
  }
}
```

## Features
- Multiple merge syntaxes (`merge:`, `$<<:`, `merge:pack`)
- Section-based imports (e.g., `resources.yml:Resources`)
- List merging support
- Automatic backup & restore
- Bulk processing support
- Pattern matching for file selection
- Support for both .yml and .yaml files
- CloudFormation schema support
- Preserves formatting and comments
- Intelligent indentation handling
- Directory-based processing
- Multiple input sources support

## File Search Behavior
The tool searches for configuration files in the following order:
1. Specified input file path
2. Current directory
3. Common subdirectories (serverless, src, config)
4. Pattern matched locations

For backup files, it maintains a `.mergebackup` directory that automatically cleans up when empty.

## Error Handling
- Automatic backup before processing
- Restore on failure
- Detailed error reporting
- Safe cleanup of backup files
- Circular reference detection

## License
MIT License - Copyright (c) 2025 SmartFingerGameStudio