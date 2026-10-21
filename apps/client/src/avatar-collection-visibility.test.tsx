import {describe,it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {AvatarModal} from "./AvatarModal";
import type {UserPresentation} from "./api";
const props={name:"Pessoa sintética",onClose:()=>{},onChanged:()=>{}};
const picker=(presentation?:UserPresentation)=>renderToStaticMarkup(<AvatarModal {...props} presentation={presentation}/>);
describe("Owner avatar collection discovery",()=>{
 it("shows COMMON and SUPER, with no Owner tab for an ordinary participant",()=>{
  const html=picker({badge:null,superActive:false});expect(html).toContain('>Comuns</button>');expect(html).toContain('>SUPER</button>');expect(html).not.toContain('>Owner</button>');
 });
 it("an ADMIN appearance alone does not reveal the Root collection",()=>{
  expect(picker({badge:"ADMIN",superActive:true,administrative:false,unlimitedXp:false})).not.toContain('>Owner</button>');
 });
 it("Root administrative authority can discover the Owner collection",()=>{
  expect(picker({badge:"ADMIN",superActive:true,administrative:true,unlimitedXp:true})).toContain('>Owner</button>');
 });
});
