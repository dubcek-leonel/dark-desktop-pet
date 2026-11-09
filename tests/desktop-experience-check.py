"""Checks the built Electron app in an isolated profile; no API credentials needed."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import json, os, subprocess, tempfile, time, urllib.request

root = Path(__file__).resolve().parents[1]
profile = Path(tempfile.mkdtemp(prefix='dark-experience-'))
(profile / 'config.json').write_text(json.dumps({'name':'Dark Test','memoryEnabled':False,'voiceEnabled':False,'listenEnabled':False,'wakeWordEnabled':False}),encoding='utf-8')
env = dict(os.environ, DARK_USER_DATA=str(profile), DARK_OPEN_SETTINGS='1')
env.pop('ELECTRON_RUN_AS_NODE',None)
env.pop('ELECTRON_RENDERER_URL',None)
log = (profile / 'desktop.log').open('w',encoding='utf-8')
proc = subprocess.Popen([str(root / 'node_modules/electron/dist/electron.exe'),str(root),'--remote-debugging-port=9258'],cwd=root,env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
try:
    for _ in range(100):
        if proc.poll() is not None: raise RuntimeError('Electron exited: '+str(proc.returncode))
        try:
            urllib.request.urlopen('http://127.0.0.1:9258/json/version',timeout=.3).close()
            break
        except Exception: time.sleep(.1)
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp('http://127.0.0.1:9258')
        context = browser.contexts[0]
        settings = None
        for _ in range(100):
            settings = next((page for page in context.pages if 'settings.html' in page.url),None)
            if settings: break
            time.sleep(.1)
        assert settings is not None
        expect(settings.locator('#connectionTitle')).to_be_visible()
        expect(settings.locator('#saveSettings')).to_be_disabled()
        settings.locator('nav [data-tab="personaje"]').click()
        settings.locator('#name').fill('Dark Prueba')
        assert json.loads((profile/'config.json').read_text(encoding='utf-8'))['name']=='Dark Test'
        settings.locator('#saveSettings').click()
        expect(settings.locator('#saved')).to_have_text('Cambios guardados')
        assert json.loads((profile/'config.json').read_text(encoding='utf-8'))['name']=='Dark Prueba'
        settings.locator('nav [data-tab="tareas"]').click()
        settings.locator('#reminderText').fill('Desktop test water')
        settings.locator('#reminderMinutes').fill('10')
        settings.locator('#quickReminder button').click()
        expect(settings.locator('#remList')).to_contain_text('Desktop test water')
        saved = json.loads((profile/'recordatorios.json').read_text(encoding='utf-8'))
        assert saved[0]['text']=='Desktop test water'
        settings.locator('#focusToggle').click()
        expect(settings.locator('#focusToggle')).to_have_text('Terminar sesión')
        assert settings.evaluate("async()=> (await api.invoke('app:overview')).focus.phase")=='focus'
        settings.locator('#focusToggle').click()
        expect(settings.locator('#focusToggle')).to_have_text('Empezar foco')
        assert settings.evaluate("async()=> (await api.invoke('app:overview')).focus.phase")=='off'
        rejected = settings.evaluate("()=> api.invoke('app:command',{type:'reminder',text:'bad',minutes:-1})")
        assert not rejected['ok']
        settings.locator('#openChat').click()
        bubble = None
        for _ in range(50):
            bubble = next((page for page in context.pages if 'bubble.html' in page.url),None)
            if bubble: break
            settings.wait_for_timeout(100)
        assert bubble is not None
        composer=None
        for _ in range(50):
            composer=next((page for page in context.pages if 'composer.html' in page.url),None)
            if composer: break
            settings.wait_for_timeout(100)
        assert composer is not None
        expect(bubble.locator('#companionName')).to_have_text('Dark Prueba')
        composer.locator('#input').fill('hola')
        composer.locator('#send').click()
        expect(bubble.locator('#retry')).to_be_visible()
        expect(bubble.locator('#answer')).to_contain_text('API key')
        assert bubble.locator('#input').count()==0
        bubble.locator('#recent summary').click()
        bubble.locator('#newChat').click()
        expect(bubble.locator('#emptyHint')).to_be_visible()
        expect(bubble.locator('#answer')).to_be_empty()
        snapshot=bubble.evaluate("()=>api.invoke('chat:snapshot')")
        assert snapshot['history']==[]
        # With the composer open the pet stays nearby; controls stay in the work area.
        pet_page=next(page for page in context.pages if page.url.endswith('/index.html'))
        before=pet_page.evaluate('({x:screenX,y:screenY})')
        time.sleep(1)
        after=pet_page.evaluate('({x:screenX,y:screenY})')
        assert before==after
        composer_bounds=composer.evaluate('({x:screenX,y:screenY,w:innerWidth,h:innerHeight})')
        assert composer_bounds['w']>=300 and composer_bounds['h']>=50
        # Single/double clicks animate the pet rather than reopening a hidden composer.
        composer.locator('#close').click()
        time.sleep(.2)
        pet_page.evaluate("window.animations=[];api.on('pet:anim',m=>animations.push(m.anim));api.send('pet:click')")
        time.sleep(.4)
        assert pet_page.evaluate("animations.includes('click')")
        pet_page.evaluate("api.send('pet:dblclick')")
        time.sleep(.2)
        assert pet_page.evaluate("animations.includes('dance')||animations.includes('surprised')")
        expect(settings.locator('#saveSettings')).to_be_disabled()
        print('Real Electron checks passed: persistence, focus, separate writing bar, missing-key recovery, reset, conversation stability and pet gestures.')
        print('Isolated profile: '+str(profile))
        browser.close()
finally:
    proc.terminate()
    try: proc.wait(timeout=8)
    except subprocess.TimeoutExpired: proc.kill()
    log.close()
