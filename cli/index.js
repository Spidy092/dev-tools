const { Command } = require('commander');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const { processFolder } = require('../core/obfuscator');
const { walkDir } = require('../core/utils');
const { writeZip } = require('../core/archiveEngine');
const { RESOURCE_POLICY, totalDeclaredBytes } = require('../core/resourcePolicy');

const program = new Command();

program
  .name('php-protector')
  .description('Obfuscate PHP files recursively in a folder')
  .version('1.0.0')
  .argument('<folder>', 'Path to the input project folder')
  .option('-o, --output <path>', 'Custom output folder path')
  .option('-z, --zip', 'Also create a ZIP of the output folder')
  .action(async (folder, options) => {
    try {
      const inputDir = path.resolve(folder);
      let inputStat;
      try { inputStat = await fs.promises.lstat(inputDir); } catch (_) {}
      if (!inputStat || inputStat.isSymbolicLink() || !inputStat.isDirectory()) {
        console.error(chalk.red(`Error: Not a valid real directory: ${inputDir}`));
        process.exitCode = 1;
        return;
      }

      const folderName = path.basename(inputDir);
      const outputDir = options.output
        ? path.resolve(options.output)
        : path.join(path.dirname(inputDir), `${folderName}_protected`);

      console.log(chalk.bold('\n PHP Protector'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.gray(`Input:  ${inputDir}`));
      console.log(chalk.gray(`Output: ${outputDir}`));
      console.log(chalk.gray('─'.repeat(40)));

      let phpCount = 0;
      let copyCount = 0;

      await processFolder(inputDir, outputDir, (relativePath, type) => {
        if (type === 'php') {
          phpCount++;
          console.log(chalk.green('  [PHP] ') + chalk.white(relativePath));
        } else {
          copyCount++;
          console.log(chalk.gray(' [COPY] ') + chalk.gray(relativePath));
        }
      });

      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.green(`Done! ${phpCount} PHP files obfuscated, ${copyCount} files copied.`));
      console.log(chalk.cyan(`Output folder: ${outputDir}`));

      if (options.zip) {
        const zipPath = `${outputDir}.zip`;
        let existingZip;
        try { existingZip = await fs.promises.lstat(zipPath); } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        if (existingZip?.isSymbolicLink()) {
          const error = new Error('Refusing to overwrite a ZIP path that is a symbolic link.');
          error.code = 'ZIP_OUTPUT_SYMLINK';
          throw error;
        }

        const outputFiles = await walkDir(outputDir, outputDir, {
          maxFiles: RESOURCE_POLICY.maxFiles,
          maxDirectories: RESOURCE_POLICY.maxFiles,
          maxDepth: 128
        });
        const entries = [];
        for (const item of outputFiles) {
          const stat = await fs.promises.stat(item.fullPath);
          if (!stat.isFile()) continue;
          entries.push({
            name: path.posix.join(path.basename(outputDir), item.relativePath.split(path.sep).join('/')),
            filePath: item.fullPath,
            size: stat.size
          });
        }
        const totalBytes = totalDeclaredBytes(entries, RESOURCE_POLICY.coreBatchBytes);
        const output = fs.createWriteStream(zipPath, { flags: 'w', mode: 0o600 });
        const result = await writeZip(output, entries, {
          level: 9,
          maxFileBytes: RESOURCE_POLICY.coreBatchBytes,
          maxTotalBytes: totalBytes
        });
        console.log(chalk.cyan(`ZIP created: ${zipPath} (${result.outputBytes || 0} bytes)`));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exitCode = 1;
    }
  });

program.parse();
