#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { EOL } = require('os');
const parseArgs = require('minimist');
const { CLOUDFORMATION_SCHEMA } = require('js-yaml-cloudformation-schema');

class YamlMergeError extends Error {
  constructor(message, filePath, originalError = null) {
    super(message);
    this.name = 'YamlMergeError';
    this.filePath = filePath;
    this.originalError = originalError;
  }
}

class Logger {
  constructor(level = 'info') {
    this.level = level;
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
  }

  log(level, message, ...args) {
    if (this.levels[level] <= this.levels[this.level]) {
      console.log(`[${level.toUpperCase()}]`, message, ...args);
    }
  }

  error(message, ...args) { this.log('error', message, ...args); }
  warn(message, ...args) { this.log('warn', message, ...args); }
  info(message, ...args) { this.log('info', message, ...args); }
  debug(message, ...args) { this.log('debug', message, ...args); }
}

class YamlLine {
  constructor(raw) {
    this.raw = raw;
    this.indent = this.calculateIndent(raw);
    this.content = raw.trim();
    this.isComment = this.content.startsWith('#');
    this.isEmpty = this.content === '';
    this.hasTag = this.content.startsWith('!');
    this.hasCloudFormation = this.content.includes('Fn::') || this.content.includes('!Ref');
    this.key = this.extractKey(this.content);
    this.isList = this.content.startsWith('-');
    this.indentLevel = Math.floor(this.indent.length / 2);
    this.isMergeDirective = this.isMergeTag();
  }

  isMergeTag() {
    const content = this.content.trim();

    if (content === 'merge:' || content === '$<<:') {
      return true;
    }

    if (content.includes('${file(')) {
      return (
          content.startsWith('merge:') ||
          content.startsWith('$<<:') ||
          content.startsWith('- ')
      );
    }

    return false;
  }

  getFileReference() {
    const content = this.content.replace(/^(merge:|$<<:|\s*-\s*)/, '').trim();
    if (content.startsWith('${file(')) {
      return content;
    }
    return null;
  }

  calculateIndent(line) {
    const match = line.match(/^(\s*)/);
    return match ? match[0] : '';
  }

  extractKey(content) {
    if (this.isEmpty || this.isComment) return null;
    const match = content.match(/^([^:]+):/);
    return match ? match[1].trim() : null;
  }

  isCapitalizedKey() {
    return this.key && /^[A-Z]/.test(this.key);
  }

  clone(newIndent = null) {
    const line = new YamlLine(this.raw);
    if (newIndent !== null) {
      line.raw = newIndent + this.raw.trimLeft();
      line.indent = newIndent;
      line.indentLevel = Math.floor(newIndent.length / 2);
    }
    return line;
  }
}

class YamlDocument {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.baseDir = path.dirname(filePath);
    this.lines = [];
    this.processedFiles = new Set();
    this.options = options;
    this.logger = options.logger || new Logger();
    this.schema = options.schema || CLOUDFORMATION_SCHEMA;
    this.preserveFormat = options.preserveFormat !== false;
    this.originalContent = null;
    this.parsedContent = null;
    this.parentDocument = options.parentDocument || null;
    this.currentIndentLevel = 0;
    this.sectionStack = [];
  }

  async load() {
    try {
      if (this.processedFiles.has(this.filePath)) {
        throw new YamlMergeError('Circular reference detected', this.filePath);
      }

      this.processedFiles.add(this.filePath);
      this.originalContent = fs.readFileSync(this.filePath, 'utf8');
      this.lines = this.originalContent.split(/\r?\n/).map(line => new YamlLine(line));
      this.parsedContent = yaml.load(this.originalContent, { schema: this.schema });
    } catch (error) {
      throw new YamlMergeError(
          error instanceof YamlMergeError ? error.message : error+ 'File loading error',
          this.filePath,
          error
      );
    }
  }

  resolveFilePath(relativePath) {
    const searchPaths = [
      path.isAbsolute(relativePath) ? relativePath : null,
      path.resolve(this.baseDir, relativePath),
      path.resolve(this.baseDir, '..', relativePath),
      path.resolve(process.cwd(), relativePath),
      ...['serverless', 'src', 'config'].map(dir =>
          path.resolve(process.cwd(), dir, relativePath)
      )
    ].filter(Boolean);

    for (const searchPath of searchPaths) {
      if (fs.existsSync(searchPath)) {
        return searchPath;
      }
    }

    throw new YamlMergeError(
        `Cannot resolve file path: ${relativePath}`,
        this.filePath
    );
  }


  extractSection(lines, sectionPath) {
    const sections = sectionPath.split('.');
    let sectionLines = [];
    let currentSection = sections[0];
    let inSection = false;
    let sectionIndent = '';

    for (const line of lines) {
      if (line.key === currentSection) {
        inSection = true;
        sectionIndent = line.indent;
        continue;
      }

      if (inSection) {
        if (!line.isEmpty && !line.isComment && line.indent.length <= sectionIndent.length) {
          break;
        }
        sectionLines.push(line);
      }
    }

    return sectionLines;
  }
  async processMerge(fileRef, parentIndent = '') {
    const resolvedPath = this.resolveFilePath(fileRef.path);
    const subDocument = new YamlDocument(resolvedPath, {
      ...this.options,
      parentDocument: this
    });

    await subDocument.load();
    await subDocument.merge();

    let mergedLines = fileRef.section ?
        this.extractSection(subDocument.lines, fileRef.section) :
        subDocument.lines;

    if (fileRef.section && fileRef.section.match(/^[A-Z]/)) {
      let lastLineEmpty = false;
      mergedLines = mergedLines.filter(line => {
        if (line.isEmpty) {
          if (lastLineEmpty) return false;
          lastLineEmpty = true;
          return true;
        }
        lastLineEmpty = false;
        return true;
      });
    }

    else {
      mergedLines = mergedLines.filter((line, index, arr) => {
        if (line.isEmpty) {
          return !(index > 0 && index < arr.length - 1 &&
              !arr[index - 1].isEmpty && !arr[index + 1].isEmpty);
        }
        return true;
      });
    }

    return mergedLines.map(line => {
      if (line.isEmpty || line.isComment) return line.clone();

      if (fileRef.section) {
        if (fileRef.section.match(/^[A-Z]/)) {
          if (line.indent.length > 0) {
            let newIndent = parentIndent;
            if (line.indent.length > 0) {
              newIndent = parentIndent.slice(0, -2);
            }
            return line.clone(newIndent + line.indent);
          }

          if (fileRef.section === line.key && line.isCapitalizedKey()) {
            return line.clone(parentIndent);
          }
        }

        else {
          if (line.key === fileRef.section) {
            return line.clone(parentIndent);
          }

          if (fileRef.section && !fileRef.section.match(/^[A-Z]/)) {
            return line.clone(parentIndent);
          }

          const relativeLine = line.clone(parentIndent + line.indent.slice(2));
          return relativeLine;
        }
      }

      if (line.isList) {
        if (fileRef.section && fileRef.section.match(/^[A-Z]/)) {
          return line.clone(parentIndent + line.indent);
        }
        else {
          return line.clone(parentIndent + line.indent);
        }
      }

      if (fileRef.section && fileRef.section.match(/^[A-Z]/)) {
        return line.clone(parentIndent + '  '.repeat(line.indentLevel));
      } else {
        return line.clone(parentIndent + '  '.repeat(line.indentLevel));
      }
    });
  }
  async merge() {
    const mergedLines = [];
    let lastLineEmpty = false;

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];

      if (line.isEmpty) {
        if (!lastLineEmpty) mergedLines.push(line);
        lastLineEmpty = true;
        continue;
      } else if (line.isComment) {
        mergedLines.push(line);
        lastLineEmpty = false;
        continue;
      }

      lastLineEmpty = false;

      if (line.isMergeDirective) {
        const fileRef = this.parseFileReference(line.content);
        if (fileRef) {
          const mergedContent = await this.processMerge(fileRef, line.indent);
          mergedLines.push(...mergedContent);
          continue;
        }
      }

      if (!line.isMergeDirective) {
        mergedLines.push(line);
      }
    }

    this.lines = mergedLines;
    return this;
  }

  parseFileReference(content) {
    content = content.replace(/^($<<:|merge:|\s*-\s*)/, '').trim();

    const match = content.match(/\$\{file\(([^)]+)\)(?::([^}]+))?\}/);
    return match ? {
      path: match[1],
      section: match[2],
      raw: match[0]
    } : null;
  }

  toString() {
    return this.lines.map(line => line.raw).join(EOL) + EOL;
  }
}

class YamlMerger {
  constructor(options = {}) {
    this.options = {
      schema: CLOUDFORMATION_SCHEMA,
      preserveFormat: true,
      logLevel: 'info',
      ...options
    };
    this.logger = new Logger(this.options.logLevel);
    this.backupDir = '.backup';
    this.backupPath = path.join(this.backupDir, 'serverless-backup.yml');
  }


  async process(inputFile, outputFile = null) {
    try {
      this.logger.info(`Processing: ${inputFile}`);

      // Create backup directory if doesn't exist
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }

      // Backup original serverless.yml
      if (fs.existsSync(inputFile)) {
        fs.copyFileSync(inputFile, this.backupPath);
        this.logger.info('Original file backed up to .backup/serverless-backup.yml');
      }

      // Load and merge YAML content
      const document = new YamlDocument(inputFile, {
        ...this.options,
        logger: this.logger
      });

      await document.load();
      await document.merge();

      // Write merged content
      const outputPath = outputFile || inputFile;
      fs.writeFileSync(outputPath, document.toString());

      this.logger.info('Merge completed successfully');
      return true;
    } catch (error) {
      this.logger.error('Merge failed:', error.message);
      if (!outputFile) {
        await this.restore(inputFile);
      }
      throw error;
    }
  }

  async restore(originalFile) {
    try {
      if (fs.existsSync(this.backupPath)) {
        this.logger.info('Restoring original serverless.yml');
        fs.copyFileSync(this.backupPath, originalFile);

        // Check if backup directory contains only our backup file
        const files = fs.readdirSync(this.backupDir);
        if (files.length === 1 && files[0] === 'serverless-backup.yml') {
          // Remove the entire backup directory
          fs.rmSync(this.backupDir, { recursive: true, force: true });
          this.logger.info('Backup directory removed');
        } else {
          // Just remove our backup file
          fs.unlinkSync(this.backupPath);
          this.logger.info('Backup file removed');
        }

        this.logger.info('Restore completed');
      }
    } catch (error) {
      this.logger.error('Restore failed:', error.message);
    }
  }
}

async function main() {
  const argv = parseArgs(process.argv.slice(2), {
    boolean: ['restore'],
    string: ['input', 'log-level'],
    alias: { i: 'input', l: 'log-level' },
    default: {
      input: 'serverless.yml',
      'log-level': 'info',
      restore: false
    }
  });

  const merger = new YamlMerger({ logLevel: argv['log-level'] });

  try {
    if (argv.restore) {
      await merger.restore(argv.input);
    } else {
      await merger.process(argv.input);
    }
  } catch (error) {
    process.exit(1);
  }

  // Add SIGINT handler for cleanup
  process.on('SIGINT', async () => {
    await merger.restore(argv.input);
    process.exit();
  });
}

if (require.main === module) {
  main();
}

module.exports = { YamlMerger, YamlDocument, YamlLine, YamlMergeError, Logger };