/* 静态服务器：用于本地模拟学习通答题页（配合 --host-resolver-rules 测试扩展） */
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 8000;
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(__dirname, urlPath === '/' ? 'mock-chaoxing.html' : urlPath);
  if (!file.startsWith(__dirname) || !fs.existsSync(file)) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' });
  res.end(fs.readFileSync(file));
});
server.listen(PORT, () => console.log('mock server: http://127.0.0.1:' + PORT + '/mock-chaoxing.html'));