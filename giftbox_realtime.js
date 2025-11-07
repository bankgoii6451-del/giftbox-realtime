// giftbox_realtime.js
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const CryptoJS = require('crypto-js');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const SECRET_KEY = 'GiftBox@2025';
const ADMIN_KEY = 'admin2025';
const DAILY_LIMIT = 3;

app.use(bodyParser.json());

function readData() {
  if (!fs.existsSync(DATA_FILE)) return { users: [], prizes: [], used: [], spins: [] };
  const enc = fs.readFileSync(DATA_FILE, 'utf8');
  if (!enc) return { users: [], prizes: [], used: [], spins: [] };
  try {
    const bytes = CryptoJS.AES.decrypt(enc, SECRET_KEY);
    const json = bytes.toString(CryptoJS.enc.Utf8);
    return JSON.parse(json || '{"users":[],"prizes":[],"used":[],"spins":[]}');
  } catch {
    return { users: [], prizes: [], used: [], spins: [] };
  }
}

function writeData(d) {
  const enc = CryptoJS.AES.encrypt(JSON.stringify(d), SECRET_KEY).toString();
  fs.writeFileSync(DATA_FILE, enc, 'utf8');
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

let activeSpin = null;
const todayKey = () => new Date().toISOString().slice(0,10);

app.post('/register', (req,res)=>{
  const {phone,password}=req.body;
  const db=readData();
  if(db.users.find(u=>u.phone===phone)) return res.json({success:false,message:'เบอร์นี้ลงทะเบียนแล้ว'});
  db.users.push({phone,password}); writeData(db);
  res.json({success:true,message:'สมัครสำเร็จ'});
});

app.post('/login',(req,res)=>{
  const {phone,password}=req.body; const db=readData();
  const u=db.users.find(x=>x.phone===phone && x.password===password);
  if(!u) return res.json({success:false,message:'ข้อมูลไม่ถูกต้อง'});
  res.json({success:true,message:'ล็อกอินสำเร็จ'});
});

app.post('/admin/addPrize',(req,res)=>{
  const {key,title,count}=req.body;
  if(key!==ADMIN_KEY) return res.json({success:false,message:'รหัสแอดมินไม่ถูกต้อง'});
  const db=readData(); db.prizes.push({id:Date.now(),title,count:Number(count)});
  writeData(db); res.json({success:true,message:'เพิ่มรางวัลเรียบร้อย'});
});

app.post('/admin/listPrizes',(req,res)=>{
  const {key}=req.body;
  if(key!==ADMIN_KEY) return res.json({success:false,message:'รหัสแอดมินไม่ถูกต้อง'});
  const db=readData(); res.json({success:true,prizes:db.prizes});
});

app.post('/spin',(req,res)=>{
  const {phone,password}=req.body; const db=readData();
  const u=db.users.find(x=>x.phone===phone && x.password===password);
  if(!u) return res.json({success:false,message:'ต้องล็อกอินก่อน'});
  const tk=todayKey();
  const userSpins=db.spins.filter(s=>s.phone===phone && s.day===tk).length;
  if(userSpins>=DAILY_LIMIT) return res.json({success:false,message:`เกินโควตาวันนี้แล้ว (${DAILY_LIMIT})`});
  if(activeSpin) return res.json({success:false,message:'กำลังสุ่มอยู่'});
  const available=db.prizes.filter(p=>p.count>0);
  if(!available.length) return res.json({success:false,message:'ไม่มีรางวัลในระบบ'});
  const spinId=Date.now(); activeSpin={id:spinId};
  broadcast({type:'spin_start',initiator:phone});
  let ticks=0; const prizePool=[]; available.forEach(p=>{for(let i=0;i<p.count;i++) prizePool.push(p)});
  const iv=setInterval(()=>{
    ticks++; const peek=prizePool[Math.floor(Math.random()*prizePool.length)];
    broadcast({type:'spin_tick',peek:peek?peek.title:'?'});
    if(ticks>25){ clearInterval(iv);
      const win=prizePool[Math.floor(Math.random()*prizePool.length)];
      if(win){ const prize=db.prizes.find(p=>p.id===win.id);
        if(prize){ prize.count--; db.used.push({phone,prize:prize.title,at:new Date().toISOString()}); }}
      db.spins.push({phone,day:tk}); writeData(db);
      broadcast({type:'spin_result',result:win?win.title:null}); activeSpin=null; }
  },200);
  res.json({success:true,message:'เริ่มสุ่มแล้ว'});
});

app.get('/',(req,res)=>res.send('<h2>GiftBox Realtime</h2><a href="/admin">Admin</a> | <a href="/game">Game</a>'));
app.get('/admin',(req,res)=>res.send('<h3>Admin</h3> POST /admin/addPrize {key,title,count}'));
app.get('/game',(req,res)=>res.send('<script>const ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host);ws.onmessage=e=>document.body.innerHTML+="<div>"+e.data+"</div>";</script><h3>Realtime Game View</h3>'));

server.listen(PORT,()=>console.log("🎁 GiftBox Realtime running on port "+PORT));
