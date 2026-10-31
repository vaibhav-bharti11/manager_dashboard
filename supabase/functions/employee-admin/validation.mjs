import {normalizePhone} from '../phone-auth/validation.mjs';
export function requireAdmin(profile) {
 if(!profile||profile.role!=='admin'||profile.active===false)throw Error('Administrator access required');
 return profile.id;
}
export function employeeInput(body) {
 const name=String(body?.name||'').trim(),phone=normalizePhone(body?.phone),restaurant_id=body?.restaurant_id;
 if(body?.role&&body.role!=='manager')throw Error('Employees must have the manager role.');
 if(name.length<2||name.length>120)throw Error('Enter an employee name between 2 and 120 characters.');
 if(body?.pin!==undefined||body?.password!==undefined)throw Error('The employee chooses their own PIN using an activation code.');
 if(!['embassy-vasant','embassy-elan','kampai','basque'].includes(restaurant_id))throw Error('Choose one of the four restaurants.');
 return {name,phone,restaurant_id};
}
