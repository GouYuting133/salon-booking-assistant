const form = document.querySelector('#customer-entry');
const title = document.querySelector('#entry-title');
const description = document.querySelector('#entry-description');
const nameField = document.querySelector('#entry-name');
const statusLine = document.querySelector('#entry-status');
const switchButton = document.querySelector('#entry-switch');
const submitButton = form.querySelector('button[type=submit]');
const passwordToggle=document.querySelector('#entry-password-toggle');
function showPassword(visible) {
  form.elements.password.type=visible?'text':'password';
  passwordToggle.toggleAttribute('data-visible',visible);
  passwordToggle.setAttribute('aria-label',visible?'隐藏密码':'显示密码');
}
passwordToggle.onclick=()=>showPassword(form.elements.password.type==='password');
let mode='register';
const accountStorageKey = 'salon-account-token';
const rememberedToken = localStorage.getItem(accountStorageKey) || sessionStorage.getItem(accountStorageKey);
if (rememberedToken) {
  sessionStorage.removeItem('salon-client-token');
  location.replace('/#customer');
}

function showMode(next) {
  mode=next;
  const registering=mode==='register';
  const username=form.elements.username;
  document.querySelector('#entry-username-label').textContent=registering?'手机号':'手机号或原账号';
  username.minLength=registering?11:4;
  username.maxLength=registering?11:24;
  username.pattern=registering?'1[3-9][0-9]{9}':'[A-Za-z0-9_]{4,24}';
  username.inputMode=registering?'tel':'text';
  username.placeholder=registering?'请输入 11 位手机号':'请输入手机号或原账号';
  nameField.hidden=!registering;
  title.textContent=registering?'创建我的理发助手':'登录我的理发助手';
  description.textContent=registering?'注册后可以自己预约，也可以查看自己的预约和到店记录。':'用手机号或原账号和密码登录。';
  form.elements.password.value='';
  showPassword(false);
  form.elements.password.autocomplete=mode==='login'?'current-password':'new-password';
  submitButton.textContent=registering?'注册并进入':'登录';
  switchButton.textContent=registering?'已有账号，去登录':'新客户，去注册';
  statusLine.textContent='';
}
switchButton.addEventListener('click',()=>showMode(mode==='login'?'register':'login'));

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitButton.disabled) return;
  const fields = Object.fromEntries(new FormData(form));
  fields.username = fields.username.trim();
  submitButton.disabled = switchButton.disabled = true;
  statusLine.textContent = '正在处理…';
  try {
    const result = await SalonHTTP.request('/api/accounts/'+mode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    if (!result.token) throw Error('暂时无法进入，请稍后登录重试');
    try {
      localStorage.setItem(accountStorageKey, result.token);
      sessionStorage.removeItem(accountStorageKey);
    } catch {
      sessionStorage.setItem(accountStorageKey, result.token);
    }
    sessionStorage.removeItem('salon-client-token');
    location.replace('/#customer');
  } catch (error) {
    statusLine.textContent = error.message;
  } finally {
    submitButton.disabled = switchButton.disabled = false;
  }
});
