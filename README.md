
# serverless-merge
[![npm version](https://badge.fury.io/js/%40smartfinger%2Fserverless-merge.svg)](https://www.npmjs.com/package/@smartfinger/serverless-merge)

Advanced serverless configuration merger with nested file support and section-based imports.

## Why?
Serverless Framework provides basic file importing capabilities but lacks advanced merge strategies. This tool enables:
- Merging multiple configuration files
- Section-based imports
- List merging
- Intelligent backup & restore

## Installation

```bash
npm install --save-dev @smartfinger/serverless-merge
```

## Usage

### Command Line
```bash
# Basic usage
npx serverless-merge -i serverless.yml

# With output file
npx serverless-merge -i serverless.yml -o serverless-merged.yml

# Restore from backup
npx serverless-merge --restore
```

### NPM Scripts
Add to your package.json:
```json
{
  "scripts": {
    "pre:deploy": "serverless-merge -i serverless.yml",
    "post:deploy": "serverless-merge --restore"
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

### Example Project Structure
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

### Note About Serverless Framework Plugin
This tool is intentionally designed as a CLI command rather than a Serverless plugin because Serverless Framework's variable resolution happens before plugins are initialized. Using it as a pre-deploy command ensures proper merging before the Framework processes the configuration.

### Programmatic Usage

```javascript
const { YamlMerger } = require('@smartfinger/serverless-merge');

async function mergeConfig() {
  const merger = new YamlMerger({ logLevel: 'info' });
  
  try {
    // Merge and backup original
    await merger.process('serverless.yml');
    
    // Your deployment logic here
    
    // Restore original
    await merger.restore('serverless.yml');
  } catch (error) {
    console.error('Merge failed:', error);
  }
}
```

## Features
- Multiple merge syntaxes (`merge:`, `$<<:`)
- Section-based imports (e.g., `resources.yml:Resources`)
- List merging support
- Automatic backup & restore
- CloudFormation schema support
- Preserves formatting and comments
- Intelligent indentation handling

## License
MIT License - Copyright (c) 2025 SmartFingerGameStudio