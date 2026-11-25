export async function editor(app,slug,{api,esc,toast,copy}){
 const endpoint='/api/campaigns/'+encodeURIComponent(slug), c=await api(endpoint), url=location.origin+'/c/'+encodeURIComponent(slug);
 document.title=c.title+' — wicend-twibbon';
 const visitKey='view:'+slug;let viewed=false;try{viewed=!!sessionStorage.getItem(visitKey);}catch{}if(!viewed)api(endpoint+'/view',{method:'POST'}).then(()=>{try{sessionStorage.setItem(visitKey,'1');}catch{}}).catch(()=>{});
 const settings=[['zoom','Zoom',0.5,4,0.01,1],['rotate','Putar',-180,180,1,0],['brightness','Kecerahan',40,180,1,100],['contrast','Kontras',40,180,1,100]];
 app.innerHTML=`<section class="wrap editpage"><a class="back" href="/jelajah">← Kembali ke jelajah</a><div class="edithead"><span class="pill ${esc(c.theme)}">${esc(c.category)}</span><h1>${esc(c.title)}</h1><p>${esc(c.description)}</p><small>Oleh ${esc(c.ownerName||'wicend-twibbon')}</small></div><div class="editgrid"><div class="stage"><canvas width="720" height="720" tabindex="0" aria-label="Pratinjau. Gunakan tombol panah untuk menggeser foto."></canvas><p>↔ Geser foto langsung pada pratinjau</p></div><div class="editpanel"><h2>Pasang fotomu</h2><p>Foto diproses di perangkatmu, bukan diunggah ke server.</p><div class="uploads"><label class="btn primary">↑ Pilih Foto<input type="file" id="photo" accept="image/jpeg,image/png,image/webp"></label><label class="btn outline">Kamera<input type="file" id="camera" accept="image/jpeg,image/png,image/webp" capture="user"></label></div><p id="photo-status" role="status" class="file-status">JPG, PNG, atau WebP · Maks. 20 MB</p><h3>Pilihan bingkai</h3><div class="reel">${c.frames.map((f,i)=>`<button type="button" data-frame="${i}" aria-label="Bingkai ${i+1}" aria-pressed="${i===0}"><img src="${esc(f)}" alt=""></button>`).join('')}</div><fieldset id="adjust" disabled><legend>Sesuaikan foto</legend><div class="ranges">${settings.map(([k,l,min,max,step,val])=>`<label>${l}<output for="${k}">${val}</output><input id="${k}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"></label>`).join('')}</div><div class="edittools"><label>Filter <select id="filter"><option value="none">Asli</option><option value="grayscale(1)">Hitam Putih</option><option value="sepia(.55)">Hangat</option><option value="saturate(1.45)">Cerah</option></select></label><button type="button" id="reset" class="btn outline sm">Reset</button></div></fieldset><div class="editactions"><button id="download" class="btn primary" disabled>↓ Unduh PNG HD</button><button id="share-file" class="btn outline" disabled>Bagikan hasil</button></div></div></div><div class="sharepanel"><h2>Sebarkan kampanye</h2><p class="caption">${esc(c.caption||'Ajak temanmu memasang bingkai ini!')}</p><div class="actions" id="sharelinks"><button class="btn outline sm" data-copy="link">Salin tautan</button><button class="btn outline sm" data-copy="caption" ${c.caption?'':'disabled'}>Salin caption</button></div><p class="sharetip">Untuk Instagram dan TikTok, simpan gambar lalu unggah dari aplikasi, atau gunakan menu Bagikan hasil jika didukung.</p></div></section>`;
 const ratios=[[1,1],[4,5],[9,16],[16,9],[3,2],[2,3]];
 app.querySelector('.reel').insertAdjacentHTML('afterend',`<div class="editratio"><label for="ratio">Rasio hasil</label><select id="ratio" aria-describedby="ratio-help"><option value="native">Rasio asli bingkai</option>${ratios.map(([w,h],i)=>`<option value="${i}">${w}:${h}</option>`).join('')}</select><p id="ratio-help">Jika rasio berbeda, bingkai tetap utuh tanpa diregangkan. Ruang di luar bingkai transparan pada PNG. Rasio asli bisa dibulatkan ke piksel terdekat agar sisi terpanjang tetap 1200–2400 px.</p></div>`);
 const $=s=>app.querySelector(s), canvas=$('canvas'), ctx=canvas.getContext('2d');let photo=null,frame=null,x=0,y=0,frameSeq=0,photoSeq=0,drag=null,queued=false;
 const bitmap=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('Gambar tidak dapat dibaca.'));im.src=src;});
 const v=k=>Number($('#'+k).value);
 const gcd=(a,b)=>b?gcd(b,a%b):a;
 function dimensions(){
  const min=1200,max=2400,target=Math.max(frame?.naturalWidth||min,frame?.naturalHeight||min);
  let fw=frame?.naturalWidth||1,fh=frame?.naturalHeight||1;
  if($('#ratio').value!=='native')[fw,fh]=ratios[$('#ratio').value];
  const d=gcd(fw,fh),w=fw/d,h=fh/d,long=Math.max(w,h);
  const low=Math.ceil(min/long),high=Math.floor(max/long);
  if(high>=low){const k=Math.min(high,Math.max(low,Math.round(target/long)));return [w*k,h*k];}
  // Some native ratios cannot fit exactly in the allowed integer pixel dimensions.
  return [Math.max(1,Math.round(max*w/long)),Math.max(1,Math.round(max*h/long))];
 }
 function paint(g,width,height,preview){
  g.clearRect(0,0,width,height);
  const scale=frame?Math.min(width/frame.naturalWidth,height/frame.naturalHeight):1;
  const fw=frame?frame.naturalWidth*scale:width,fh=frame?frame.naturalHeight*scale:height;
  const left=(width-fw)/2,top=(height-fh)/2;
  if(photo){const ratio=Math.max(fw/photo.naturalWidth,fh/photo.naturalHeight)*v('zoom'),w=photo.naturalWidth*ratio,h=photo.naturalHeight*ratio;g.save();g.beginPath();g.rect(left,top,fw,fh);g.clip();g.translate(width*(.5+x),height*(.5+y));g.rotate(v('rotate')*Math.PI/180);g.filter=`brightness(${v('brightness')}%) contrast(${v('contrast')}%) ${$('#filter').value==='none'?'':$('#filter').value}`.trim();g.drawImage(photo,-w/2,-h/2,w,h);g.restore();}
  else if(preview){g.fillStyle='#42675e';g.textAlign='center';g.font=`650 ${Math.min(width,height)*.029}px system-ui`;g.fillText('Tempat fotomu',width/2,height/2);}
  if(frame)g.drawImage(frame,left,top,fw,fh);
 }
 const render=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;const [w,h]=dimensions(),s=Math.min(1,900/Math.max(w,h));const pw=Math.max(1,Math.round(w*s)),ph=Math.max(1,Math.round(h*s));if(canvas.width!==pw)canvas.width=pw;if(canvas.height!==ph)canvas.height=ph;ctx.setTransform(pw/w,0,0,ph/h,0,0);paint(ctx,w,h,true);});};
 $('#ratio').addEventListener('change',render);
 const toggle=()=>{$('#adjust').disabled=!photo;$('#download').disabled=$('#share-file').disabled=!(photo&&frame);};
 async function selectFrame(i){const seq=++frameSeq;frame=null;toggle();app.querySelectorAll('[data-frame]').forEach(b=>b.setAttribute('aria-pressed',Number(b.dataset.frame)===i));render();try{const im=await bitmap(c.frames[i]);if(seq===frameSeq){frame=im;toggle();render();}}catch(e){if(seq===frameSeq)toast(e.message);}}
 function reset(){x=y=0;for(const [k,,,,val] of settings){$('#'+k).value=val;$( `output[for="${k}"]`).textContent=val;}$('#filter').value='none';render();}
 async function upload(file){if(!file)return;if(!(/\.(jpe?g|png|webp)$/i.test(file.name)||/^image\/(jpeg|png|webp)$/.test(file.type))||file.size>20*1024*1024){toast('Gunakan JPG, PNG, atau WebP maksimal 20 MB.');return;}const seq=++photoSeq;const src=URL.createObjectURL(file);try{const im=await bitmap(src);if(seq===photoSeq){photo=im;$('#photo-status').textContent=file.name;reset();toggle();}}catch(e){if(seq===photoSeq)toast(e.message);}finally{URL.revokeObjectURL(src);}}
 for(const id of ['photo','camera'])$('#'+id).addEventListener('change',e=>{upload(e.target.files[0]);e.target.value='';});
 canvas.addEventListener('dragover',e=>e.preventDefault());canvas.addEventListener('drop',e=>{e.preventDefault();upload(e.dataTransfer.files[0]);});
 canvas.addEventListener('pointerdown',e=>{if(!photo||drag)return;canvas.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY};});
 canvas.addEventListener('pointermove',e=>{if(drag?.id!==e.pointerId)return;const {width,height}=canvas.getBoundingClientRect();if(!width||!height)return;x+=(e.clientX-drag.x)/width;y+=(e.clientY-drag.y)/height;drag.x=e.clientX;drag.y=e.clientY;render();});
 canvas.addEventListener('lostpointercapture',()=>{drag=null;});
 canvas.addEventListener('keydown',e=>{const dirs={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};if(!photo||!dirs[e.key])return;e.preventDefault();const [dx,dy]=dirs[e.key],s=e.shiftKey?.05:.01;x+=dx*s;y+=dy*s;render();});
 $('#adjust').addEventListener('input',e=>{const out=$( `output[for="${e.target.id}"]`);if(out)out.textContent=e.target.value;render();});$('#reset').onclick=reset;$('.reel').onclick=e=>{const b=e.target.closest('[data-frame]');if(b)selectFrame(Number(b.dataset.frame));};
 for(const [name,target] of [['WhatsApp','https://wa.me/?text='+encodeURIComponent([c.caption,url].filter(Boolean).join('\n'))],['Facebook','https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(url)],['X','https://x.com/intent/tweet?url='+encodeURIComponent(url)+'&text='+encodeURIComponent(c.caption||c.title)],['Instagram','https://www.instagram.com/'],['TikTok','https://www.tiktok.com/']]){const a=document.createElement('a');a.className='btn outline sm';a.href=target;a.target='_blank';a.rel='noopener noreferrer';a.textContent=name+' ↗';$('#sharelinks').append(a);}
 $('#sharelinks').addEventListener('click',e=>{if(e.target.dataset.copy)copy(e.target.dataset.copy==='link'?url:c.caption);});
 const name=`${slug}-twibbon.png`;
 const exportBlob=()=>{const out=document.createElement('canvas');const [w,h]=dimensions();out.width=w;out.height=h;paint(out.getContext('2d'),w,h,false);return new Promise((resolve,reject)=>out.toBlob(blob=>blob?resolve(blob):reject(new Error('Tidak dapat membuat PNG.')),'image/png'));};
 $('#download').onclick=async()=>{try{const b=await exportBlob();const link=document.createElement('a');link.href=URL.createObjectURL(b);link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),30000);api(endpoint+'/download',{method:'POST',keepalive:true}).catch(()=>{});toast('PNG siap diunduh.');}catch(e){toast(e.message);}};
 $('#share-file').onclick=async()=>{try{const f=new File([await exportBlob()],name,{type:'image/png'});if(navigator.canShare?.({files:[f]})&&navigator.share){await navigator.share({files:[f],title:c.title});}else toast('Browser ini tidak mendukung bagikan file. Unduh PNG lalu unggah dari aplikasi tujuan.');}catch(e){if(e.name!=='AbortError')toast('Bagikan belum berhasil. Unduh PNG lalu unggah dari aplikasi tujuan.');}};
 selectFrame(0);
}
