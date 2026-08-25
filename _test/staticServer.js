// 极简静态服务器，所有响应都带 Cache-Control: no-store，彻底禁用浏览器缓存
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
http.createServer((req,res)=>{
  let url=req.url.split('?')[0]; if(url==='/')url='/index.html';
  const f=path.join(ROOT,url);
  fs.readFile(f,(e,d)=>{
    if(e){res.writeHead(404,{'Cache-Control':'no-store'});res.end('not found');return;}
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store, no-cache, must-revalidate','Pragma':'no-cache','Expires':'0'});
    res.end(d);
  });
}).listen(8624,()=>console.log('staticServer on 8624'));
