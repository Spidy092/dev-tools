const TOOLS = Object.freeze([
  {
    id: 'php-protector',
    name: 'PHP Protector',
    category: 'Security',
    icon: '🛡️',
    route: '/php-protector',
    view: 'php-protector',
    description: 'Obfuscate PHP projects recursively while preserving project structure.',
    keywords: ['php', 'security', 'obfuscate', 'source'],
    workflow: {
      endpoint: '/upload',
      dropTitle: 'Drop your project folder here',
      dropSubtitle: 'PHP files will be obfuscated and returned with project structure preserved.',
      browseLabel: 'Browse project',
      excludePlaceholder: 'e.g. vendor/*, node_modules/*, *.log',
      processLabel: 'Protect Files',
      progressLabel: 'Securing your code…',
      completeLabel: 'Protection complete!',
      downloadLabel: 'Download Result',
      resetLabel: 'Protect more',
      stats: [
        { id: 'total', label: 'Total files' },
        { id: 'php', label: 'PHP files' },
        { id: 'done', label: 'Processed' }
      ]
    }
  },
  {
    id: 'image-resizer',
    name: 'Image Resizer',
    category: 'Images',
    icon: '📐',
    route: '/image-resizer',
    view: 'image-resizer',
    description: 'Resize individual images or complete folders with predictable fit controls.',
    keywords: ['image', 'resize', 'crop', 'dimensions'],
    workflow: {
      endpoint: '/image-tools/resize',
      dropTitle: 'Drop your image folder here',
      dropSubtitle: 'Review one, many, or a complete folder before resizing.',
      browseLabel: 'Browse images',
      excludePlaceholder: 'e.g. thumbs/*, *.ico',
      processLabel: 'Resize Files',
      progressLabel: 'Scaling pixels…',
      completeLabel: 'Resizing complete!',
      downloadLabel: 'Download Result',
      resetLabel: 'Resize more',
      stats: [
        { id: 'total', label: 'Files queued' },
        { id: 'done', label: 'Processed' }
      ]
    }
  },
  {
    id: 'image-converter',
    name: 'Image Converter',
    category: 'Images',
    icon: '🔄',
    route: '/image-converter',
    view: 'image-converter',
    description: 'Convert images in bulk between modern and common image formats.',
    keywords: ['image', 'convert', 'webp', 'avif', 'png', 'jpeg'],
    workflow: {
      endpoint: '/image-tools/convert',
      dropTitle: 'Drop your image folder here',
      dropSubtitle: 'Review your images, choose output settings, then convert.',
      browseLabel: 'Browse images',
      excludePlaceholder: 'e.g. thumbs/*, *.ico',
      processLabel: 'Convert Files',
      progressLabel: 'Converting images…',
      completeLabel: 'Conversion complete!',
      downloadLabel: 'Download Result',
      resetLabel: 'Convert more',
      stats: [
        { id: 'total', label: 'Files queued' },
        { id: 'done', label: 'Processed' }
      ]
    }
  },
  {
    id: 'image-compressor',
    name: 'Image Compressor',
    category: 'Images',
    icon: '🗜️',
    route: '/image-compressor',
    view: 'image-compressor',
    description: 'Compress one image, many images, or folder structures with quality controls.',
    keywords: ['image', 'compress', 'optimize', 'quality', 'metadata'],
    workflow: {
      endpoint: '/image-compressor-tools/compress',
      dropTitle: 'Drop your image folder here',
      dropSubtitle: 'All supported formats can be reviewed before compression.',
      browseLabel: 'Browse images',
      excludePlaceholder: 'e.g. thumbs/*, *.ico',
      processLabel: 'Compress Files',
      progressLabel: 'Compressing images…',
      completeLabel: 'Compression complete!',
      downloadLabel: 'Download Result',
      resetLabel: 'Compress more',
      stats: [
        { id: 'total', label: 'Files queued' },
        { id: 'done', label: 'Processed' },
        { id: 'saved', label: 'Space saved', initial: '0%' }
      ]
    }
  },
  {
    id: 'pdf-compressor',
    name: 'PDF Compressor',
    category: 'PDF',
    icon: '📄',
    route: '/pdf-compressor',
    view: 'pdf-compressor',
    description: 'Reduce PDF size with guarded Ghostscript quality presets.',
    keywords: ['pdf', 'compress', 'ghostscript', 'documents'],
    workflow: {
      endpoint: '/pdf-tools/compress',
      dropTitle: 'Drop your PDF folder here',
      dropSubtitle: 'Review PDFs before guarded Ghostscript compression.',
      browseLabel: 'Browse PDFs',
      excludePlaceholder: 'e.g. archive/*, draft_*',
      processLabel: 'Compress PDFs',
      progressLabel: 'Compressing PDFs…',
      completeLabel: 'PDF compression complete!',
      downloadLabel: 'Download Result',
      resetLabel: 'Compress more',
      stats: [
        { id: 'total', label: 'PDFs queued' },
        { id: 'done', label: 'Processed' }
      ]
    }
  },
  {
    id: 'file-renamer',
    name: 'Smart File Renamer',
    category: 'Files',
    icon: '🏷️',
    route: '/file-renamer',
    view: 'file-renamer',
    description: 'Rename and organize files in bulk using reusable naming rules.',
    keywords: ['files', 'rename', 'bulk', 'organize'],
    workflow: {
      endpoint: '/file-tools/rename',
      dropTitle: 'Drop your folder here',
      dropSubtitle: 'Review every filename before applying rename rules.',
      browseLabel: 'Browse files',
      excludePlaceholder: 'e.g. .git/*, *.tmp',
      processLabel: 'Rename Files',
      progressLabel: 'Renaming files…',
      completeLabel: 'Renaming complete!',
      downloadLabel: 'Download Result',
      resetLabel: 'Rename more',
      stats: [
        { id: 'total', label: 'Files queued' },
        { id: 'done', label: 'Processed' }
      ]
    }
  },
  {
    id: 'code-minifier',
    name: 'Code Minifier',
    category: 'Code',
    icon: '⚡',
    route: '/code-minifier',
    view: 'code-minifier',
    description: 'Minify HTML, CSS, and JavaScript individually or across projects.',
    keywords: ['code', 'minify', 'html', 'css', 'javascript'],
    workflow: {
      endpoint: '/minify-tools/minify',
      dropTitle: 'Drop your codebase here',
      dropSubtitle: 'Review the project before minifying selected file types.',
      browseLabel: 'Browse project',
      excludePlaceholder: 'e.g. node_modules/*, *.min.js',
      processLabel: 'Minify Files',
      progressLabel: 'Minifying code…',
      completeLabel: 'Minification complete!',
      downloadLabel: 'Download Result',
      resetLabel: 'Minify more',
      stats: [
        { id: 'total', label: 'Files queued' },
        { id: 'done', label: 'Processed' }
      ]
    }
  }
]);

function publicTools() {
  return TOOLS.map(({ view, workflow, ...tool }) => tool);
}

module.exports = { TOOLS, publicTools };
