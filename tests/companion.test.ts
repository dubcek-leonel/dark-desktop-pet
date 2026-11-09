import { describe, expect, it } from 'vitest'
import { parseCompanionAction } from '../src/core/companion'

describe('companion commands', () => {
  it('validates and trims a reminder before it can create a real timer', () => {
    expect(parseCompanionAction({ type: 'reminder', text: '  water  ', minutes: 20 })).toEqual({ type: 'reminder', text: 'water', minutes: 20 })
  })
  it.each([null, {}, {type:'unknown'}, {type:'reminder',text:'',minutes:1}, {type:'reminder',text:'x',minutes:-1}, {type:'reminder',text:'x',minutes:1.5}, {type:'reminder',text:'x',minutes:Infinity}, {type:'reminder',text:'x',minutes:'20'}, {type:'reminder',text:'x',minutes:10081}, {type:'reminder',text:'x'.repeat(201),minutes:1}])('rejects an invalid action: %j', (value) => {
    expect(() => parseCompanionAction(value)).toThrow()
  })
})
