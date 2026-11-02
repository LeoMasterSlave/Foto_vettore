(function(){
 class Tensor{constructor(t,d,dims){this.type=t;this.data=d;this.dims=dims;}}
 const names={17925367:'id',28016810:'enc',16505766:'dec'};
 (typeof window!=='undefined'?window:self).ort={env:{wasm:{},versions:{web:'mock'}},Tensor,InferenceSession:{async create(buf){
   const m=names[buf.byteLength]; const ins={id:['input_image'],enc:['input_image'],dec:['image_embeddings','point_coords','point_labels','mask_input','has_mask_input','orig_im_size']}[m];
   const outs={id:['output_image'],enc:['image_embeddings'],dec:['masks','iou_predictions','low_res_masks']}[m];
   return {inputNames:ins,outputNames:outs,release:async()=>{},async run(feeds){
     const meta=[],parts=[]; for(const k of ins){const t=feeds[k]; if(t._ref){meta.push([k,[1],'ref']);continue;} meta.push([k,t.dims,'f']);parts.push(new Uint8Array(t.data.buffer,t.data.byteOffset,t.data.byteLength));}
     let len=parts.reduce((a,p)=>a+p.length,0); const body=new Uint8Array(len); let o=0; for(const p of parts){body.set(p,o);o+=p.length;}
     const org=(self.location&&self.location.origin&&self.location.origin!=='null')?self.location.origin:'';const r=await fetch(org+'/run?m='+m,{method:'POST',headers:{'X-Meta':JSON.stringify(meta)},body}); const out=JSON.parse(r.headers.get('X-Out')); const ab=await r.arrayBuffer(); const res={}; let off=0;
     for(const [n,sh] of out){const c=sh.reduce((a,b)=>a*b,1);res[n]=new Tensor('float32',m==='enc'?new Float32Array(1):new Float32Array(ab.slice(off,off+4*c)),sh); if(m==='enc')res[n]._ref=1; off+=4*c;} return res;}};
 }}};
})();
