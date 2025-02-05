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
    this.backupDir = '.mergebackup';
  }


  // Yeni yardımcı method - Yapılandırma dosyasını bulur
  findConfigFile(inputFile) {
    // Özel dosya belirtilmişse önce onu kontrol et
    if (inputFile && fs.existsSync(inputFile)) {
      return inputFile;
    }

    // Varsayılan dosyaları sırayla kontrol et
    const defaultFiles = [
      'serverless.yml',
      'serverless.yaml',
      'template.yml',
      'template.yaml'
    ];

    for (const file of defaultFiles) {
      if (fs.existsSync(file)) {
        this.logger.info(`Found configuration file: ${file}`);
        return file;
      }
    }

    throw new Error('No valid configuration file found');
  }

  getBackupPath(inputFile) {
    const fileName = path.basename(inputFile);
    const backupName = `${path.parse(fileName).name}-backup${path.parse(fileName).ext}`;
    const backupPath = path.join(this.backupDir, backupName);

    // Eğer backup dosyası varsa yolunu döndür
    if (fs.existsSync(backupPath)) {
      return backupPath;
    }

    // Backup bulunamadıysa null döndür
    return null;
  }

  hasMergeDirectives(content) {
    return content.includes('merge:') || content.includes('$<<:') || content.includes('merge:pack');
  }

  removeBackupTags(content) {
    return content.replace(/#MergeBackup\n/g, '');
  }


  async restore(inputFile = null) {
    try {
      const configFile = this.findConfigFile(inputFile);
      const backupPath = this.getBackupPath(configFile);

      if (!backupPath) {
        this.logger.warn(`No backup found for ${configFile}`);
        return false;
      }

      const backupContent = fs.readFileSync(backupPath, 'utf8');

      if (backupContent.includes('#MergeBackup')) {
        this.logger.info(`Restoring original ${configFile}`);
        const contentToRestore = this.removeBackupTags(backupContent);
        fs.writeFileSync(configFile, contentToRestore);
        fs.unlinkSync(backupPath);
        this.logger.info('Backup file removed');
        this.cleanBackupDirectory();
        this.logger.info('Restore completed');
        return true;
      } else {
        this.logger.warn('Backup file exists but does not have backup tag. Skipping restore.');
        return false;
      }
    } catch (error) {
      this.logger.error('Restore failed:', error.message);
      throw error;
    }
  }

  findYamlFiles(directory) {
    const yamlFiles = [];
    const files = fs.readdirSync(directory);

    files.forEach(file => {
      const filePath = path.join(directory, file);
      const stats = fs.statSync(filePath);

      if (stats.isFile() &&
          (file.endsWith('.yml') || file.endsWith('.yaml')) &&
          !file.includes('-backup')) {
        yamlFiles.push(path.normalize(filePath));
      }
    });

    return yamlFiles;
  }

  cleanBackupDirectory() {
    if (fs.existsSync(this.backupDir)) {
      const files = fs.readdirSync(this.backupDir);
      if (files.length === 0) {
        fs.rmdirSync(this.backupDir);
        this.logger.info('Empty backup directory removed');
      }
    }
  }


  handleBulkError(operation, filePath, error) {
    this.logger.error(`${operation} failed for ${filePath}:`, error.message);
    return {
      file: filePath,
      success: false,
      error: error.message
    };
  }

  async process(inputFile = null, outputFile = null) {
    let isRestoreNeeded = false;

    try {
      if (!inputFile) {
        throw new Error('Input file is required');
      }

      // Dosya yolunu normalize et
      const normalizedPath = path.normalize(inputFile);

      this.logger.info(`Processing: ${normalizedPath}`);

      if (!fs.existsSync(normalizedPath)) {
        throw new Error(`Input file not found: ${normalizedPath}`);
      }

      // Backup path oluştur
      const backupPath = path.join(this.backupDir, `${path.basename(normalizedPath, path.extname(normalizedPath))}-backup${path.extname(normalizedPath)}`);
      const originalContent = fs.readFileSync(normalizedPath, 'utf8');

      // Merge yönergelerini ve yedeği kontrol et
      if (!this.hasMergeDirectives(originalContent) && fs.existsSync(backupPath)) {
        const backupContent = fs.readFileSync(backupPath, 'utf8');
        if (backupContent.includes('#MergeBackup')) {
          this.logger.info('No merge directives found and valid backup exists. Restoring first...');
          await this.restore(normalizedPath);
          return this.process(normalizedPath, outputFile);
        }
      }

      // Yedek dizini yoksa oluştur
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }

      // MergeBackup tag'i ile yedek oluştur
      const cleanContent = this.removeBackupTags(originalContent);
      const contentToBackup = '#MergeBackup\n' + cleanContent;
      fs.writeFileSync(backupPath, contentToBackup);
      this.logger.info(`Original file backed up to ${backupPath}`);
      isRestoreNeeded = true;

      // YAML içeriğini yükle ve birleştir
      const document = new YamlDocument(normalizedPath, {
        ...this.options,
        logger: this.logger
      });

      await document.load();
      await document.merge();

      // Birleştirilmiş içeriği yaz
      const outputPath = outputFile || normalizedPath;
      fs.writeFileSync(outputPath, document.toString());

      this.logger.info('Merge completed successfully');
      return true;

    } catch (error) {
      this.logger.error('Merge failed:', error.message);
      if (isRestoreNeeded && !outputFile) {
        try {
          await this.restore(inputFile);
        } catch (restoreError) {
          this.logger.error('Restore after merge failure also failed:', restoreError.message);
          throw restoreError;
        }
      }
      throw error;
    }
  }

  async bulkProcess(directory = null, pattern = null) {
    const results = [];
    let files = new Set();

    try {
      if (directory) {
        const normalizedDir = path.normalize(directory);
        if (fs.existsSync(normalizedDir)) {
          if (fs.statSync(normalizedDir).isDirectory()) {
            // Dizin ise içindeki yaml dosyalarını bul
            const dirFiles = this.findYamlFiles(normalizedDir);
            dirFiles.forEach(file => files.add(file));
          } else {
            // Tek dosya ise direkt ekle
            files.add(normalizedDir);
          }
        }
      }

      if (pattern) {
        const glob = require('glob');
        const matchedFiles = glob.sync(pattern, { cwd: process.cwd(), absolute: true });
        matchedFiles.forEach(file => files.add(path.normalize(file)));
      }

      const fileArray = Array.from(files);
      if (fileArray.length === 0) {
        this.logger.warn('No YAML files found for processing');
        return [];
      }

      this.logger.info(`Starting bulk process for ${fileArray.length} files`);

      for (const file of fileArray) {
        try {
          await this.process(file);
          results.push({
            file,
            success: true
          });
          this.logger.info(`Successfully processed: ${file}`);
        } catch (error) {
          results.push(this.handleBulkError('Process', file, error));
        }
      }

      const successCount = results.filter(r => r.success).length;
      this.logger.info(`Bulk process completed. Success: ${successCount}/${fileArray.length}`);

      return results;
    } catch (error) {
      this.logger.error('Bulk process operation failed:', error.message);
      throw error;
    }
  }



  async bulkRestore(directory = null, pattern = null) {
    const results = [];
    let files = new Set();

    try {
      if (directory) {
        if (fs.statSync(directory).isDirectory()) {
          // Dizin ise backup dosyalarını kontrol et
          if (fs.existsSync(this.backupDir)) {
            const backupFiles = fs.readdirSync(this.backupDir)
                .filter(file => file.endsWith('-backup.yml') || file.endsWith('-backup.yaml'));

            backupFiles.forEach(backupFile => {
              const originalName = backupFile.replace('-backup', '');
              const filePath = path.join(directory, originalName);
              if (fs.existsSync(filePath)) {
                files.add(filePath);
              }
            });
          }
        } else {
          // Tek dosya ise direkt ekle
          files.add(directory);
        }
      }

      if (pattern) {
        const glob = require('glob');
        const matchedFiles = glob.sync(pattern);
        matchedFiles.forEach(file => files.add(file));
      }

      const fileArray = Array.from(files);
      if (fileArray.length === 0) {
        this.logger.warn('No files found for restore');
        return [];
      }

      this.logger.info(`Starting bulk restore for ${fileArray.length} files`);

      for (const file of fileArray) {
        try {
          const success = await this.restore(file);
          results.push({
            file,
            success
          });
          if (success) {
            this.logger.info(`Successfully restored: ${file}`);
          }
        } catch (error) {
          results.push(this.handleBulkError('Restore', file, error));
        }
      }

      const successCount = results.filter(r => r.success).length;
      this.logger.info(`Bulk restore completed. Success: ${successCount}/${fileArray.length}`);

      this.cleanBackupDirectory();

      return results;
    } catch (error) {
      this.logger.error('Bulk restore operation failed:', error.message);
      throw error;
    }
  }

}

async function main() {
  const argv = parseArgs(process.argv.slice(2), {
    boolean: ['restore', 'bulk'],
    string: ['input', 'log-level', 'pattern'],
    alias: {
      i: 'input',
      l: 'log-level',
      b: 'bulk',
      p: 'pattern'
    },
    default: {
      'log-level': 'info',
      restore: false,
      bulk: false
    }
  });

  const merger = new YamlMerger({ logLevel: argv['log-level'] });

  try {
    // input parametrelerini array'e çevir
    let inputs = [];
    if (Array.isArray(argv.input)) {
      inputs = argv.input;
    } else if (argv.input) {
      inputs = [argv.input];
    }

    if (argv.bulk) {
      if (argv.restore) {
        // Her input için bulk restore yap
        for (const input of inputs) {
          await merger.bulkRestore(input, argv.pattern);
        }
      } else {
        // Her input için bulk process yap
        for (const input of inputs) {
          await merger.bulkProcess(input, argv.pattern);
        }
      }
    } else {
      // Tekil işlemler için
      if (argv.restore) {
        for (const input of inputs) {
          await merger.restore(input);
        }
      } else {
        for (const input of inputs) {
          await merger.process(input);
        }
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { YamlMerger, YamlDocument, YamlLine, YamlMergeError, Logger };