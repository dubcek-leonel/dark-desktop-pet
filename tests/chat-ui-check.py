from playwright.sync_api import sync_playwright, expect
from pathlib import Path
from urllib.parse import urlsplit
import mimetypes

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,channel='msedge')
    root=Path(__file__).resolve().parents[1]/'out'/'renderer'
    def serve(route):
        target=root/urlsplit(route.request.url).path.lstrip('/')
        route.fulfill(body=target.read_bytes(),content_type=mimetypes.guess_type(target)[0] or 'application/octet-stream')
    def make_page(name,height):
        page=browser.new_page(viewport={'width':380,'height':height})
        page.add_init_script("""window.handlers={};window.sent=[];window.api={on:(c,fn)=>handlers[c]=fn,send:(c,...a)=>sent.push([c,...a]),invoke:async c=>c==='chat:snapshot'?{history:[],current:null,question:''}:{config:{name:'Dark'}}};window.update=m=>handlers['chat:update'](m);""")
        page.route('http://localhost:8765/**',serve)
        page.goto('http://localhost:8765/'+name+'.html')
        page.wait_for_load_state('networkidle')
        return page
    response=make_page('bubble',430)
    composer=make_page('composer',54)
    errors=[]
    for page in [response,composer]:page.on('pageerror',lambda e:errors.append(str(e)))
    def update(msg):
        for page in [response,composer]:page.evaluate('m=>update(m)',msg)
    assert response.locator('#input').count()==0
    composer.locator('#input').fill('Hola')
    composer.locator('#send').click()
    expect(composer.locator('#send')).to_be_disabled()
    assert composer.evaluate("sent.some(x=>x[0]==='chat:send'&&x[1]==='Hola')")
    update({'state':'thinking','question':'Hola'})
    update({'state':'talking','text':'Hola de nuevo'})
    update({'state':'notice','text':'Tomar agua','buttons':[{'id':'dismiss','label':'Listo'}]})
    expect(response.locator('#answer')).to_have_text('Hola de nuevo')
    expect(response.locator('#alerts button')).to_have_count(1)
    response.locator('#stop').click()
    assert response.evaluate("sent.some(x=>x[0]==='chat:cancel')")
    update({'state':'error','text':'Sin conexión','retryable':True})
    expect(response.locator('#retry')).to_be_visible()
    response.locator('#retry').click()
    assert response.evaluate("sent.some(x=>x[0]==='chat:retry')")
    update({'state':'thinking','question':'Una explicación larga'})
    text='Una explicación que se lee paso a paso. '*24
    update({'state':'done','text':text,'emotion':'neutral','notes':[]})
    expect(response.locator('#pager')).to_be_visible()
    expect(composer.locator('#send')).to_be_enabled()
    first=response.locator('#answer').inner_text()
    response.locator('#nextPage').click()
    assert response.locator('#answer').inner_text()!=first or response.locator('#pageNumber').inner_text().startswith('2 /')
    response.locator('#close').click()
    assert response.evaluate("sent.some(x=>x[0]==='chat:dismiss')")
    update({'state':'listening'})
    expect(composer.locator('#mic')).to_have_attribute('data-listening','true')
    composer.locator('#mic').click()
    assert composer.evaluate("sent.some(x=>x[0]==='chat:mic')")
    update({'state':'ready'})
    expect(composer.locator('#mic')).to_have_attribute('data-listening','false')
    composer.locator('#close').click()
    assert composer.evaluate("sent.some(x=>x[0]==='chat:close')")
    update({'state':'done','text':'Aquí estoy. ¿Qué hacemos?','emotion':'happy','notes':[]})
    response.screenshot(path=str(root.parent/'interaction-response-preview.png'))
    composer.screenshot(path=str(root.parent/'interaction-composer-preview.png'))
    response.locator('#recent summary').click()
    response.once('dialog',lambda d:d.accept())
    response.locator('#newChat').click()
    assert response.evaluate("sent.some(x=>x[0]==='chat:reset')")
    update({'state':'reset'})
    expect(response.locator('#history .turn')).to_have_count(0)
    assert not errors,errors
    print('Interaction UI checks passed: separate composer, stop/retry, paginated answers, voice toggle, notices and independent closing.')
    browser.close()
