import {expect,it} from "vitest";
import {groupCodeFromSubject} from "./group-name.js";
it.each([['SOS YOUTUBER 1','1'],['SOS YOUTUBER $2$','2'],[' sos youtuber $999$ ','999']])('recognizes real family %s',(name,code)=>expect(groupCodeFromSubject(name)).toBe(code));
it.each(['SOS YOUTUBER 0','SOS YOUTUBER $1000$','SOS YOUTUBER $1','Outra Comunidade 1'])('rejects unrecognized %s',name=>expect(groupCodeFromSubject(name)).toBeUndefined());
