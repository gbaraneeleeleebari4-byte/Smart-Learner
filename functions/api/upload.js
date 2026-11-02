
const BUCKET = 'my-first-bucket';
const MAX = 10 * 1024 * 1024;
const TYPES = new Set(['image/jpeg','image/png','application/pdf']);

async function identifyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const apiKey = env.FIREBASE_WEB_API_KEY || 'AIzaSyBalfqEksKXbrcfVCqrrWkILx_V7up25Xs';
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token})});
  if (!r.ok) return null;
  const d = await r.json(); const u = d.users?.[0];
  return u?.localId ? {uid:u.localId,email:u.email||'',token} : null;
}
async function isGroupMember(groupId, uid, token, env){
  const db=env.FIREBASE_DATABASE_URL||'https://smart-learn-hub-73667-default-rtdb.europe-west1.firebasedatabase.app';
  const r=await fetch(`${db}/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(uid)}.json?auth=${encodeURIComponent(token)}`);
  if(!r.ok)return false; return !!(await r.json());
}
function json(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}})}
export async function onRequestPost({request,env}){
  try{
    const user=await identifyUser(request,env); if(!user)return json({error:'Authentication required.'},401);
    if(!env.DBBYTE_API_KEY)return json({error:'Storage is not configured.'},500);
    const form=await request.formData(); const file=form.get('file');
    if(!file||typeof file.arrayBuffer!=='function')return json({error:'Please select a file.'},400);
    if(!TYPES.has(file.type))return json({error:'Only JPG, PNG, and PDF files are allowed.'},415);
    if(file.size>MAX)return json({error:'File must be 10 MB or smaller.'},413);
    const scope=String(form.get('scope')||'private'); const groupId=String(form.get('groupId')||'');
    if(scope==='group'&&(!groupId||!(await isGroupMember(groupId,user.uid,user.token,env))))return json({error:'You must be a member of this group.'},403);
    const safe=String(file.name||'file').replace(/[^a-zA-Z0-9._-]/g,'_');
    const key=`${scope}/${user.uid}/${crypto.randomUUID()}-${safe}`;
    const up=new FormData(); up.append('file',file,key);
    const r=await fetch(`https://api.dbbyte.com/storage/${BUCKET}/upload`,{method:'POST',headers:{Authorization:`Bearer ${env.DBBYTE_API_KEY}`},body:up});
    const d=await r.json().catch(()=>({})); if(!r.ok)return json({error:d.error||'DBByte upload failed.'},r.status);
    return json({success:true,uid:user.uid,scope,groupId,key:d.key||key,name:d.name||file.name,fileId:d.fileId||'',mimeType:d.mimeType||file.type,size:d.size||file.size});
  }catch(e){console.error(e);return json({error:'Something went wrong while uploading.'},500)}
}

