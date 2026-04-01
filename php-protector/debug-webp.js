const http = require('http');
const fs = require('fs');
const path = require('path');

async function testWebP() {
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const url = 'http://localhost:3000/image-tools/convert';

  const files = [
    { name: 'test-image.jpg', path: 'test-image.jpg', rel: 'folder/test-image.jpg' }
  ];

  let body = Buffer.alloc(0);

  for (const f of files) {
    const content = fs.readFileSync(f.path);
    
    // files part
    body = Buffer.concat([
      body,
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="files"; filename="${f.rel}"\r\n`),
      Buffer.from(`Content-Type: image/jpeg\r\n\r\n`),
      content,
      Buffer.from(`\r\n`)
    ]);

    // paths part
    body = Buffer.concat([
      body,
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="paths"\r\n\r\n`),
      Buffer.from(`${f.rel}\r\n`)
    ]);
  }

  // quality part
  body = Buffer.concat([
    body,
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="quality"\r\n\r\n`),
    Buffer.from(`80\r\n`)
  ]);

  body = Buffer.concat([body, Buffer.from(`--${boundary}--\r\n`)]);

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length
    }
  };

  const req = http.request(url, options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    if (res.statusCode === 200) {
      const fileStream = fs.createWriteStream('webp-test-output.zip');
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        console.log('Successfully downloaded webp-test-output.zip');
        process.exit(0);
      });
    } else {
      res.on('data', (d) => process.stdout.write(d));
      process.exit(1);
    }
  });

  req.on('error', (e) => {
    console.error(e);
    process.exit(1);
  });

  req.write(body);
  req.end();
}

testWebP();
