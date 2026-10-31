import React,{useState} from 'react';
import {UtensilsCrossed,ArrowRight,Lock} from 'lucide-react';
import {supabase} from './api.mjs';
export default function Login({onLogin}) {
 const [mode,setMode]=useState('phone'),[identity,setIdentity]=useState(''),[secret,setSecret]=useState(''),[code,setCode]=useState(''),[confirm,setConfirm]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const switchMode=value=>{setMode(value);setIdentity('');setSecret('');setCode('');setConfirm('');setError('')};
 return <div className="login-wrap"><section className="login-panel glass">
  <span className="wordmark"><UtensilsCrossed size={25}/>service.</span><span className="login-eyebrow">THE DAILY STANDARD</span>
  <h1>Good service starts<br/>with the details.</h1><p>{mode==='activate'?'Set your own PIN using the activation code from your admin.':'Sign in to your restaurant workspace.'}</p>
  <div className="segmented login-modes"><button type="button" className={mode==='phone'?'selected':''} onClick={()=>switchMode('phone')}>Phone + PIN</button><button type="button" className={mode==='activate'?'selected':''} onClick={()=>switchMode('activate')}>First-time setup</button></div>
  <form onSubmit={async e=>{e.preventDefault();setError('');if(mode==='activate'&&secret!==confirm){setError('The PINs do not match.');return}setBusy(true);try{await onLogin(identity,secret,mode,mode==='activate'?code:undefined)}catch(e){setError(e.message)}finally{setBusy(false)}}}>
   <label>{mode==='admin'?'Admin email address':'Phone number'}<input type={mode==='admin'?'email':'tel'} autoComplete="username" required value={identity} onChange={e=>setIdentity(e.target.value)} placeholder={mode==='admin'?'Your admin email':'Your phone number, including country code'}/></label>
   {mode==='activate'&&<label>One-time activation code<input required autoComplete="off" value={code} onChange={e=>setCode(e.target.value)} placeholder="Code from your administrator"/></label>}
   <label>{mode==='admin'?'Password':mode==='activate'?'Choose your 4-digit PIN':'4-digit PIN'}<input type="password" required inputMode={mode==='admin'?undefined:'numeric'} pattern={mode==='admin'?undefined:'[0-9]{4}'} maxLength={mode==='admin'?undefined:4} autoComplete={mode==='activate'?'new-password':'current-password'} value={secret} onChange={e=>setSecret(e.target.value)}/></label>
   {mode==='activate'&&<label>Confirm your PIN<input type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>}
   {error&&<div className="error" role="alert">{error}</div>}{!supabase&&<div className="error">Database connection is not configured.</div>}
   <button className="button dark" disabled={busy||!supabase}>{busy?'Please wait…':mode==='activate'?'Set PIN and sign in':'Sign in to your workspace'}<ArrowRight size={16}/></button>
  </form>
  <button className="text-button legacy-admin" type="button" onClick={()=>switchMode(mode==='admin'?'phone':'admin')}>{mode==='admin'?'Back to phone sign-in':'Existing admin email sign-in'}</button>
  <small className="login-footer"><Lock size={11}/>PIN changes are available only inside your signed-in dashboard.</small>
 </section></div>;
}
