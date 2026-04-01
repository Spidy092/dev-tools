const fs = require('fs');
const path = require('path');

/**
 * Takes PHP source code string, returns obfuscated PHP string.
 * Prepends '?>' to ensure HTML mode, base64 encodes, wraps in eval().
 */
function obfuscateCode(code) {
  // Prepend '?>' to the code so that eval() starts in HTML mode.
  // This allows it to correctly handle files that start with HTML or have mixed content.
  const payload = "?>" + code;
  const encoded = Buffer.from(payload).toString('base64');
  return `<?php eval(base64_decode('${encoded}'));`;
}

/**
 * Recursively walks inputDir.
 * For every file found:
 *   - if .php → obfuscate and write to outputDir (same relative path)
 *   - else    → copy as-is to outputDir (same relative path)
 * Calls onFile(relativePath, type) callback for each file processed.
 * type is either 'php' or 'copy'
 */
function processFolder(inputDir, outputDir, onFile) {
  // Walk function — recursive
  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullInputPath = path.join(currentDir, entry.name);
      // Relative path from root input dir
      const relativePath = path.relative(inputDir, fullInputPath);
      const fullOutputPath = path.join(outputDir, relativePath);

      if (entry.isDirectory()) {
        // Create matching directory in output
        fs.mkdirSync(fullOutputPath, { recursive: true });
        // Recurse into it
        walk(fullInputPath);
      } else if (entry.isFile()) {
        // Make sure parent dir exists in output
        fs.mkdirSync(path.dirname(fullOutputPath), { recursive: true });

        if (path.extname(entry.name).toLowerCase() === '.php') {
          // Obfuscate PHP
          const original = fs.readFileSync(fullInputPath, 'utf8');
          const protected_ = obfuscateCode(original);
          fs.writeFileSync(fullOutputPath, protected_, 'utf8');
          if (onFile) onFile(relativePath, 'php');
        } else {
          // Copy everything else as-is
          fs.copyFileSync(fullInputPath, fullOutputPath);
          if (onFile) onFile(relativePath, 'copy');
        }
      }
    }
  }

  // Create output root dir
  fs.mkdirSync(outputDir, { recursive: true });
  walk(inputDir);
}

module.exports = { obfuscateCode, processFolder };
