const TOOLS = Object.freeze([
  {
    id: 'php-protector',
    name: 'PHP Protector',
    category: 'Security',
    icon: '🛡️',
    route: '/php-protector',
    view: 'php-protector',
    description: 'Obfuscate PHP projects recursively while preserving project structure.',
    keywords: ['php', 'security', 'obfuscate', 'source']
  },
  {
    id: 'image-resizer',
    name: 'Image Resizer',
    category: 'Images',
    icon: '📐',
    route: '/image-resizer',
    view: 'image-resizer',
    description: 'Resize individual images or complete folders with predictable fit controls.',
    keywords: ['image', 'resize', 'crop', 'dimensions']
  },
  {
    id: 'image-converter',
    name: 'Image Converter',
    category: 'Images',
    icon: '🔄',
    route: '/image-converter',
    view: 'image-converter',
    description: 'Convert images in bulk between modern and common image formats.',
    keywords: ['image', 'convert', 'webp', 'avif', 'png', 'jpeg']
  },
  {
    id: 'image-compressor',
    name: 'Image Compressor',
    category: 'Images',
    icon: '🗜️',
    route: '/image-compressor',
    view: 'image-compressor',
    description: 'Compress one image, many images, or folder structures with quality controls.',
    keywords: ['image', 'compress', 'optimize', 'quality', 'metadata']
  },
  {
    id: 'pdf-compressor',
    name: 'PDF Compressor',
    category: 'PDF',
    icon: '📄',
    route: '/pdf-compressor',
    view: 'pdf-compressor',
    description: 'Reduce PDF size with guarded Ghostscript quality presets.',
    keywords: ['pdf', 'compress', 'ghostscript', 'documents']
  },
  {
    id: 'file-renamer',
    name: 'Smart File Renamer',
    category: 'Files',
    icon: '🏷️',
    route: '/file-renamer',
    view: 'file-renamer',
    description: 'Rename and organize files in bulk using reusable naming rules.',
    keywords: ['files', 'rename', 'bulk', 'organize']
  },
  {
    id: 'code-minifier',
    name: 'Code Minifier',
    category: 'Code',
    icon: '⚡',
    route: '/code-minifier',
    view: 'code-minifier',
    description: 'Minify HTML, CSS, and JavaScript individually or across projects.',
    keywords: ['code', 'minify', 'html', 'css', 'javascript']
  }
]);

function publicTools() {
  return TOOLS.map(({ view, ...tool }) => tool);
}

module.exports = { TOOLS, publicTools };
