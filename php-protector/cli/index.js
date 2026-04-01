const { Command } = require('commander');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { processFolder } = require('../core/obfuscator');

const program = new Command();

program
  .name('php-protector')
  .description('Obfuscate PHP files recursively in a folder')
  .version('1.0.0')
  .argument('<folder>', 'Path to the input project folder')
  .option('-o, --output <path>', 'Custom output folder path')
  .option('-z, --zip', 'Also create a ZIP of the output folder')
  .action((folder, options) => {
    // Resolve absolute paths
    const inputDir = path.resolve(folder);

    // Validate input exists
    if (!fs.existsSync(inputDir)) {
      console.error(chalk.red(`Error: Folder not found: ${inputDir}`));
      process.exit(1);
    }
    if (!fs.statSync(inputDir).isDirectory()) {
      console.error(chalk.red(`Error: Path is not a folder: ${inputDir}`));
      process.exit(1);
    }

    // Determine output folder
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

    // Process the folder
    processFolder(inputDir, outputDir, (relativePath, type) => {
      if (type === 'php') {
        phpCount++;
        console.log(chalk.green('  [PHP] ') + chalk.white(relativePath));
      } else {
        copyCount++;
        console.log(chalk.gray(' [COPY] ') + chalk.gray(relativePath));
      }
    });

    // Summary
    console.log(chalk.gray('─'.repeat(40)));
    console.log(chalk.green(`Done! ${phpCount} PHP files obfuscated, ${copyCount} files copied.`));
    console.log(chalk.cyan(`Output folder: ${outputDir}`));

    // ZIP if requested
    if (options.zip) {
      const zipPath = `${outputDir}.zip`;
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        console.log(chalk.cyan(`ZIP created: ${zipPath} (${archive.pointer()} bytes)`));
      });

      archive.on('error', (err) => {
        console.error(chalk.red('ZIP error: ' + err.message));
      });

      archive.pipe(output);
      archive.directory(outputDir, path.basename(outputDir));
      archive.finalize();
    }
  });

program.parse();
