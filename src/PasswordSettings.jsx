import React,{useState} from 'react';
import {phoneRequest} from './api.mjs';
export default function PinSettings({profile}) {
 const [current,setCurrent]=useState(''),[pin,setPin]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 if(!profile?.pin_ready)return <div className="password-settings"><h3>Phone and PIN sign-in</h3><p className="policy-help">Ask your administrator to attach your phone number and give you a one-time activation code. Use First-time setup on the sign-in page to choose your own PIN.</p></div>;
 return <form className="password-settings" onSubmit={async e=>{e.preventDefault();setError('');setSuccess('');if(pin!==confirm){setError('The PINs do not match.');return}setBusy(true);try{await phoneRequest({action:'change_pin',current_pin:current,new_pin:pin});setCurrent('');setPin('');setConfirm('');setSuccess('Your PIN has been changed.')}catch(e){setError(e.message)}finally{setBusy(false)}}}>
  <h3>Change your PIN</h3><p className="policy-help">Only you can change your PIN, from this signed-in dashboard.</p>
  <div className="field-grid">{[['Current PIN',current,setCurrent,'current-password'],['New 4-digit PIN',pin,setPin,'new-password'],['Confirm new PIN',confirm,setConfirm,'new-password']].map(([label,value,setter,auto])=><label key={label}>{label}<input type="password" required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete={auto} value={value} onChange={e=>setter(e.target.value)}/></label>)}</div>
  {error&&<div className="error" role="alert">{error}</div>}{success&&<p role="status">{success}</p>}
  <button className="button dark" disabled={busy}>{busy?'Updating…':'Update PIN'}</button>
 </form>;
}
