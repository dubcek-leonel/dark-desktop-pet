"""Settings interaction and failure checks using the built renderer."""
from playwright.sync_api import sync_playwright, expect
from pathlib import Path
from urllib.parse import urlsplit
import mimetypes

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={"width":760,"height":760})
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.add_init_script("""
      window.handlers={};window.calls=[];window.failSave=false;window.failInstall=false;window.rejectInstall=false;window.slowProbe=false;
      window.cfg={provider:'gemini',model:'demo',baseUrl:'https://example.test',name:'Dark',wanderEnabled:true,personality:'Tranquilo',scale:1,sleepAfterMinutes:5,startWithWindows:false,memoryEnabled:true,pomodoroFocusMin:25,pomodoroBreakMin:5,voiceEnabled:false,voiceEngine:'piper',voiceId:'es_MX-ald-medium',geminiVoice:'Puck',voiceSpeed:1,voicePitch:1,listenEnabled:false,wakeWordEnabled:false,conversationMode:true,pushToTalkKey:'Ctrl+Alt+D',sttEngine:'auto',whisperModel:'tiny'};
      window.keys={gemini:false,openai:false,ollama:true};
      window.vs={piper:false,whisper:false,voices:{},models:{},catalog:[{id:'es_MX-ald-medium',label:'Ald — México',sizeMB:60}],whisperModels:[{id:'tiny',label:'Rápido',sizeMB:75}],geminiVoices:[{id:'Puck',label:'Puck'}],hasGeminiKey:false};
      window.overview={name:'Dark',configured:false,voice:false,listening:false,memories:2,reminders:0,focus:{phase:'off',remainingMs:0,focusMin:25,breakMin:5}};
      window.reminders=[];
      window.api={on:(c,fn)=>handlers[c]=fn,send:(c,...args)=>calls.push([c,...args]),invoke:async(c,a)=>{
        calls.push([c,a]);
        if(c==='config:get')return {config:structuredClone(cfg),hasKey:structuredClone(keys),presets:{gemini:{label:'Gemini',model:'demo',baseUrl:'https://example.test',needsKey:true},openai:{label:'OpenAI',model:'',baseUrl:'https://openai.test',needsKey:true},ollama:{label:'Ollama',model:'local',baseUrl:'http://localhost:11434',needsKey:false}}};
        if(c==='voice:status')return structuredClone(vs);
        if(c==='memory:list')return ['Le gusta el café','Se llama Leo'];
        if(c==='reminders:list')return structuredClone(reminders);
        if(c==='app:overview')return structuredClone(overview);
        if(c==='config:save'){
          if(failSave)return {ok:false,error:'No hay espacio para guardar. Libera espacio y reintenta.'};
          Object.assign(cfg,a.config);if(a.apiKey)keys[cfg.provider]=true;vs.hasGeminiKey=keys.gemini;
          overview.focus.focusMin=cfg.pomodoroFocusMin;overview.focus.breakMin=cfg.pomodoroBreakMin;
          return {ok:true,config:structuredClone(cfg),hasKey:structuredClone(keys)};
        }
        if(c==='voice:install'){
          if(rejectInstall)throw new Error('Sin conexión para descargar');
          if(failInstall)return {ok:false,error:'Descarga interrumpida'};
          if(a.kind==='tts'){vs.piper=true;vs.voices[a.id]=true;}else{vs.whisper=true;vs.models[a.id]=true;}
          return {ok:true};
        }
        if(c==='ai:test'){if(slowProbe)await new Promise(r=>setTimeout(r,500));return {ok:true,text:'Funciono'};}
        if(c==='ai:listModels')return {ok:true,models:['demo','other']};
        if(c==='voice:micTest')throw new Error('Micrófono no disponible');
        if(c==='app:command'){
          if(a.type==='focusStart'){overview.focus.phase='focus';overview.focus.remainingMs=1500000;}
          if(a.type==='focusStop')overview.focus.phase='off';
          if(a.type==='reminder'){overview.reminders++;reminders.push({id:'one',text:a.text,when:'En 10 minutos'});}
          return {ok:true,text:'Acción completada'};
        }
        return {ok:true};
      }};
    """)
    root=Path(__file__).resolve().parents[1]/'out'/'renderer'
    def serve(route):
        target=root/urlsplit(route.request.url).path.lstrip('/')
        route.fulfill(body=target.read_bytes(),content_type=mimetypes.guess_type(target)[0] or 'application/octet-stream')
    page.route('http://localhost:8765/**',serve)
    page.goto('http://localhost:8765/settings.html')
    page.wait_for_load_state('networkidle')
    expect(page.locator('section[data-tab="ia"]')).to_be_visible()
    expect(page.locator('#saveSettings')).to_be_disabled()
    expect(page.locator('#saved')).to_have_text('Sin cambios pendientes')
    assert page.locator('[data-tab="inicio"]').count()==0
    assert not page.evaluate("calls.some(c=>c[0]==='voice:install')")
    page.screenshot(path=str(root.parent/'settings-preview.png'))
    page.locator('#test').click()
    expect(page.locator('#probe')).to_contain_text('La conexión funciona')
    page.evaluate('slowProbe=true')
    page.locator('#test').click()
    page.locator('#provider').select_option('ollama')
    page.wait_for_timeout(600)
    expect(page.locator('#probe')).to_be_hidden()
    page.locator('#provider').select_option('gemini')
    page.evaluate('slowProbe=false')
    page.locator('#apiKey').fill('gemini-test-key')
    page.locator('#showKey').click()
    expect(page.locator('#apiKey')).to_have_attribute('type','text')
    page.locator('#provider').select_option('openai')
    expect(page.locator('#apiKey')).to_be_empty()
    page.locator('#apiKey').fill('other-test-key')
    page.locator('#provider').select_option('gemini')
    expect(page.locator('#apiKey')).to_have_value('gemini-test-key')
    expect(page.locator('#apiKey')).to_have_attribute('type','password')
    page.locator('#saveSettings').click()
    expect(page.locator('#saved')).to_have_text('Cambios guardados')
    assert page.evaluate("calls.filter(c=>c[0]==='config:save').at(-1)[1].apiKey==='gemini-test-key'")
    page.locator('nav [data-tab="voz"]').click()
    expect(page.locator('#speakOptions')).to_be_hidden()
    page.locator('#voiceEnabled').check()
    expect(page.locator('#speakOptions')).to_be_visible()
    expect(page.locator('#voiceDownload')).to_be_visible()
    expect(page.locator('#voiceTest')).to_be_disabled()
    assert not page.evaluate("calls.some(c=>c[0]==='voice:install')")
    page.evaluate('failInstall=true')
    page.locator('#voiceDownload').click()
    expect(page.locator('#voiceStatus')).to_contain_text('Descarga interrumpida')
    expect(page.locator('#voiceDownload')).to_be_enabled()
    page.evaluate('failInstall=false;rejectInstall=true')
    page.locator('#voiceDownload').click()
    expect(page.locator('#voiceStatus')).to_contain_text('Sin conexión')
    page.evaluate('rejectInstall=false')
    page.locator('#voiceDownload').click()
    expect(page.locator('#voiceTest')).to_be_enabled()
    page.locator('#voiceEngine').select_option('gemini')
    expect(page.locator('#voicePick')).to_have_value('Puck')
    page.locator('#voiceEngine').select_option('piper')
    expect(page.locator('#voicePick')).to_have_value('es_MX-ald-medium')
    page.locator('#listenOn').check()
    page.locator('#sttEngine').select_option('whisper')
    expect(page.locator('#sttDownload')).to_be_visible()
    page.locator('#sttDownload').click()
    expect(page.locator('#micTest')).to_be_enabled()
    page.locator('#micTest').click()
    expect(page.locator('#listenStatus')).to_contain_text('Micrófono no disponible')
    expect(page.locator('#micTest')).to_be_enabled()
    page.screenshot(path=str(root.parent/'settings-voice-preview.png'))
    page.locator('nav [data-tab="personaje"]').click()
    page.locator('#name').fill('Nuevo Dark')
    page.evaluate('failSave=true')
    page.locator('#saveSettings').click()
    expect(page.locator('#saved')).to_contain_text('No hay espacio')
    expect(page.locator('#saveSettings')).to_be_enabled()
    page.evaluate('failSave=false')
    page.locator('#saveSettings').click()
    expect(page.locator('#saved')).to_have_text('Cambios guardados')
    expect(page.locator('#title')).to_have_text('Ajustes de Nuevo Dark')
    page.locator('#sleep').fill('0')
    page.locator('nav [data-tab="ia"]').click()
    page.locator('#saveSettings').click()
    expect(page.locator('section[data-tab="personaje"]')).to_be_visible()
    page.locator('#sleep').fill('5')
    page.locator('nav [data-tab="tareas"]').click()
    page.locator('#focusMin').fill('30')
    page.locator('#focusToggle').click()
    expect(page.locator('#focusToggle')).to_have_text('Terminar sesión')
    assert page.evaluate('cfg.pomodoroFocusMin===30')
    page.locator('#focusToggle').click()
    expect(page.locator('#focusToggle')).to_have_text('Empezar foco')
    page.locator('#reminderText').fill('Tomar agua')
    page.locator('#reminderMinutes').fill('10')
    page.locator('#quickReminder button').click()
    expect(page.locator('#remList')).to_contain_text('Tomar agua')
    page.locator('#openChat').click()
    assert page.evaluate("calls.some(c=>c[0]==='app:command'&&c[1].type==='chat')")
    page.locator('nav [data-tab="memoria"]').click()
    expect(page.locator('#memList li')).to_have_count(2)
    page.locator('nav [data-tab="ia"]').click()
    for width in [760,560,420]:
        page.set_viewport_size({'width':width,'height':560})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        expect(page.locator('#saveSettings')).to_be_in_viewport()
        expect(page.locator('nav')).to_be_in_viewport()
    broken=context_page=browser.new_page(viewport={'width':760,'height':760})
    broken.add_init_script("window.api={on:()=>{},send:()=>{},invoke:async()=>{throw new Error('Servicio no disponible')}}")
    broken.route('http://localhost:8765/**',serve)
    broken.goto('http://localhost:8765/settings.html')
    expect(broken.locator('#retryLoad')).to_be_visible()
    expect(broken.locator('#saved')).to_contain_text('No se pudieron cargar')
    assert not errors,errors
    print('Settings checks passed: direct navigation, explicit save, key isolation, voice downloads, error recovery, validation, tasks and compact layout.')
    browser.close()
