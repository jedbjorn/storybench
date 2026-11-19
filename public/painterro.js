/*! Painterro 1.2.92 and its bundled Lodash, both MIT: see /painterro.LICENSE.txt */
var pc=Object.create;var Dl=Object.defineProperty;var uc=Object.getOwnPropertyDescriptor;var dc=Object.getOwnPropertyNames;var fc=Object.getPrototypeOf,gc=Object.prototype.hasOwnProperty;var mc=(re,Ht)=>()=>{try{return Ht||re((Ht={exports:{}}).exports,Ht),Ht.exports}catch(Pt){throw Ht=0,Pt}};var Cc=(re,Ht,Pt,O)=>{if(Ht&&typeof Ht=="object"||typeof Ht=="function")for(let _ of dc(Ht))!gc.call(re,_)&&_!==Pt&&Dl(re,_,{get:()=>Ht[_],enumerable:!(O=uc(Ht,_))||O.enumerable});return re};var wc=(re,Ht,Pt)=>(Pt=re!=null?pc(fc(re)):{},Cc(Ht||!re||!re.__esModule?Dl(Pt,"default",{value:re,enumerable:!0}):Pt,re));var _l=mc((vc,Pl)=>{Pl.exports=(()=>{var re={737:(O,_,S)=>{"use strict";S.d(_,{Z:()=>et});var $=S(15),h=S.n($),U=S(645),it=S.n(U)()(h());it.push([O.id,`.color-diwget-btn {
    height: 32px;
    width: 32px;
    cursor: pointer;
    z-index: 1;
}

.color-diwget-btn-substrate {
    width: 32px;
}

select.ptro-input[data-id='fontName'] {
    width: 45px;
}

.ptro-bar .ptro-tool-ctl-name {
    padding: 0 2px 0 0;
    font-family: "Open Sans", sans-serif;
    line-height: 22px;
}

.ptro-bar .ptro-tool-ctl-name {
    margin-left: 5px;
    border-top-left-radius: 10px;
    border-bottom-left-radius: 10px;
    padding-left: 3px;
    padding-top: 4px;
    padding-bottom: 4px;
}

.ptro-info {
    font-family: "Open Sans", sans-serif;
    font-size: 10px;
    padding: 4px;
    margin-left: auto;
    word-break: keep-all;
    white-space: normal;
    text-align: right;
}

.ptro-info > span {
    opacity: 0.5;
}

@media screen and (max-width: 768px) {
    .ptro-bar > div {
        white-space: nowrap;
    }
    span.ptro-bar-right {
        float: none;
    }
    span.ptro-info {
        display: none;
    }
    
}

.ptro-bar .ptro-input {
    height: 32px;
    line-height: 32px;
    font-family: "Open Sans", sans-serif;
    font-size: 16px;
    position: relative;
    padding-left: 2px;
    padding-right: 0;
}

.ptro-bar .ptro-input[type="number"] {
    width: 42px;
}

.ptro-bar .ptro-named-btn p {
    margin: 0;
}

.ptro-bar {
    bottom: 0;
    position: absolute;
    width: 100%;
    font-size: 16px;
    line-height: normal;
}

.ptro-bar > div {
    position: relative;
}

.ptro-bar > div::-webkit-scrollbar {
    height: 2px;
}
    
/* Track */
.ptro-bar > div::-webkit-scrollbar-track {
    background: #f1f1f1;
}
    
/* Handle */
.ptro-bar > div::-webkit-scrollbar-thumb {
    background: #888;
}
    
/* Handle on hover */
.ptro-bar > div::-webkit-scrollbar-thumb:hover {
    background: #555;
}

.ptro-bar .ptro-icon-btn {
}

button.ptro-icon-right:first-of-type {
    margin-right: 4px;
}

button.ptro-input[data-value="false"],button.ptro-input[data-value="true"] {
    width: 28px;
    height: 28px;
    border: 0;
    background: transparent;
    display: flex;
    justify-content: center;
    align-items: center;
    padding-left: 0px;
    cursor: pointer;
    outline: 0;
}

button.ptro-input[data-value="true"]::after {
    content: '\u2714';
    font-size: 20px;
    line-height: 12px;
    width: 12px;
    height: 12px;
    border: 0;
    /* background: rgba(0,0,0,0.5); */
    display: inline-block;
}

@-webkit-keyframes ptro-spin {
  0% {
    -webkit-transform: rotate(0deg);
    transform: rotate(0deg);
  }
  100% {
    -webkit-transform: rotate(359deg);
    transform: rotate(359deg);
  }
}
@keyframes ptro-spin {
  0% {
    -webkit-transform: rotate(0deg);
    transform: rotate(0deg);
  }
  100% {
    -webkit-transform: rotate(359deg);
    transform: rotate(359deg);
  }
}

.ptro-spinning {
    -webkit-animation: ptro-spin 0.5s infinite steps(9);
    animation: ptro-spin 0.8s infinite steps(9);
    display: inline-block;
    text-rendering: auto;
    -webkit-font-smoothing: antialiased;
}

#container-bar {
    display: block;
}`,"",{version:3,sources:["webpack://./css/bar-styles.css"],names:[],mappings:"AAAA;IACI,YAAY;IACZ,WAAW;IACX,eAAe;IACf,UAAU;AACd;;AAEA;IACI,WAAW;AACf;;AAEA;IACI,WAAW;AACf;;AAEA;IACI,kBAAkB;IAClB,oCAAoC;IACpC,iBAAiB;AACrB;;AAEA;IACI,gBAAgB;IAChB,4BAA4B;IAC5B,+BAA+B;IAC/B,iBAAiB;IACjB,gBAAgB;IAChB,mBAAmB;AACvB;;AAEA;IACI,oCAAoC;IACpC,eAAe;IACf,YAAY;IACZ,iBAAiB;IACjB,oBAAoB;IACpB,mBAAmB;IACnB,iBAAiB;AACrB;;AAEA;IACI,YAAY;AAChB;;AAEA;IACI;QACI,mBAAmB;IACvB;IACA;QACI,WAAW;IACf;IACA;QACI,aAAa;IACjB;;AAEJ;;AAEA;IACI,YAAY;IACZ,iBAAiB;IACjB,oCAAoC;IACpC,eAAe;IACf,kBAAkB;IAClB,iBAAiB;IACjB,gBAAgB;AACpB;;AAEA;IACI,WAAW;AACf;;AAEA;IACI,SAAS;AACb;;AAEA;IACI,SAAS;IACT,kBAAkB;IAClB,WAAW;IACX,eAAe;IACf,mBAAmB;AACvB;;AAEA;IACI,kBAAkB;AACtB;;AAEA;IACI,WAAW;AACf;;AAEA,UAAU;AACV;IACI,mBAAmB;AACvB;;AAEA,WAAW;AACX;IACI,gBAAgB;AACpB;;AAEA,oBAAoB;AACpB;IACI,gBAAgB;AACpB;;AAEA;AACA;;AAEA;IACI,iBAAiB;AACrB;;AAEA;IACI,WAAW;IACX,YAAY;IACZ,SAAS;IACT,uBAAuB;IACvB,aAAa;IACb,uBAAuB;IACvB,mBAAmB;IACnB,iBAAiB;IACjB,eAAe;IACf,UAAU;AACd;;AAEA;IACI,YAAY;IACZ,eAAe;IACf,iBAAiB;IACjB,WAAW;IACX,YAAY;IACZ,SAAS;IACT,iCAAiC;IACjC,qBAAqB;AACzB;;AAEA;EACE;IACE,+BAA+B;IAC/B,uBAAuB;EACzB;EACA;IACE,iCAAiC;IACjC,yBAAyB;EAC3B;AACF;AACA;EACE;IACE,+BAA+B;IAC/B,uBAAuB;EACzB;EACA;IACE,iCAAiC;IACjC,yBAAyB;EAC3B;AACF;;AAEA;IACI,mDAAmD;IACnD,2CAA2C;IAC3C,qBAAqB;IACrB,oBAAoB;IACpB,mCAAmC;AACvC;;AAEA;IACI,cAAc;AAClB",sourcesContent:[`.color-diwget-btn {
    height: 32px;
    width: 32px;
    cursor: pointer;
    z-index: 1;
}

.color-diwget-btn-substrate {
    width: 32px;
}

select.ptro-input[data-id='fontName'] {
    width: 45px;
}

.ptro-bar .ptro-tool-ctl-name {
    padding: 0 2px 0 0;
    font-family: "Open Sans", sans-serif;
    line-height: 22px;
}

.ptro-bar .ptro-tool-ctl-name {
    margin-left: 5px;
    border-top-left-radius: 10px;
    border-bottom-left-radius: 10px;
    padding-left: 3px;
    padding-top: 4px;
    padding-bottom: 4px;
}

.ptro-info {
    font-family: "Open Sans", sans-serif;
    font-size: 10px;
    padding: 4px;
    margin-left: auto;
    word-break: keep-all;
    white-space: normal;
    text-align: right;
}

.ptro-info > span {
    opacity: 0.5;
}

@media screen and (max-width: 768px) {
    .ptro-bar > div {
        white-space: nowrap;
    }
    span.ptro-bar-right {
        float: none;
    }
    span.ptro-info {
        display: none;
    }
    
}

.ptro-bar .ptro-input {
    height: 32px;
    line-height: 32px;
    font-family: "Open Sans", sans-serif;
    font-size: 16px;
    position: relative;
    padding-left: 2px;
    padding-right: 0;
}

.ptro-bar .ptro-input[type="number"] {
    width: 42px;
}

.ptro-bar .ptro-named-btn p {
    margin: 0;
}

.ptro-bar {
    bottom: 0;
    position: absolute;
    width: 100%;
    font-size: 16px;
    line-height: normal;
}

.ptro-bar > div {
    position: relative;
}

.ptro-bar > div::-webkit-scrollbar {
    height: 2px;
}
    
/* Track */
.ptro-bar > div::-webkit-scrollbar-track {
    background: #f1f1f1;
}
    
/* Handle */
.ptro-bar > div::-webkit-scrollbar-thumb {
    background: #888;
}
    
/* Handle on hover */
.ptro-bar > div::-webkit-scrollbar-thumb:hover {
    background: #555;
}

.ptro-bar .ptro-icon-btn {
}

button.ptro-icon-right:first-of-type {
    margin-right: 4px;
}

button.ptro-input[data-value="false"],button.ptro-input[data-value="true"] {
    width: 28px;
    height: 28px;
    border: 0;
    background: transparent;
    display: flex;
    justify-content: center;
    align-items: center;
    padding-left: 0px;
    cursor: pointer;
    outline: 0;
}

button.ptro-input[data-value="true"]::after {
    content: '\u2714';
    font-size: 20px;
    line-height: 12px;
    width: 12px;
    height: 12px;
    border: 0;
    /* background: rgba(0,0,0,0.5); */
    display: inline-block;
}

@-webkit-keyframes ptro-spin {
  0% {
    -webkit-transform: rotate(0deg);
    transform: rotate(0deg);
  }
  100% {
    -webkit-transform: rotate(359deg);
    transform: rotate(359deg);
  }
}
@keyframes ptro-spin {
  0% {
    -webkit-transform: rotate(0deg);
    transform: rotate(0deg);
  }
  100% {
    -webkit-transform: rotate(359deg);
    transform: rotate(359deg);
  }
}

.ptro-spinning {
    -webkit-animation: ptro-spin 0.5s infinite steps(9);
    animation: ptro-spin 0.8s infinite steps(9);
    display: inline-block;
    text-rendering: auto;
    -webkit-font-smoothing: antialiased;
}

#container-bar {
    display: block;
}`],sourceRoot:""}]);let et=it},223:(O,_,S)=>{"use strict";S.d(_,{Z:()=>Q});var $=S(15),h=S.n($),U=S(645),it=S.n(U),et=S(667),bt=S.n(et),pt=S(796),ut=S(788),dt=it()(h()),_t=bt()(pt.Z),H=bt()(ut.Z);dt.push([O.id,`@font-face {
	font-family: "ptroiconfont";
	src: url(`+_t+`) format("woff"),
url(`+H+`) format("truetype");
	font-weight: normal;
    font-style: normal;
}

.ptro-icon {
}

.ptro-icon:before {
	font-family: ptroiconfont !important;
	font-style: normal !important;
	font-weight: normal !important;
	font-variant: normal !important;
	text-transform: none !important;
	speak: none;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
}

.ptro-icon-apply:before {
	content: "\\f101";
}
.ptro-icon-arrow:before {
	content: "\\f102";
}
.ptro-icon-brush:before {
	content: "\\f103";
}
.ptro-icon-bucket:before {
	content: "\\f104";
}
.ptro-icon-clear:before {
	content: "\\f105";
}
.ptro-icon-close:before {
	content: "\\f106";
}
.ptro-icon-crop:before {
	content: "\\f107";
}
.ptro-icon-ellipse:before {
	content: "\\f108";
}
.ptro-icon-eraser:before {
	content: "\\f109";
}
.ptro-icon-filters:before {
	content: "\\f10a";
}
.ptro-icon-line:before {
	content: "\\f10b";
}
.ptro-icon-linked:before {
	content: "\\f10c";
}
.ptro-icon-loading:before {
	content: "\\f10d";
}
.ptro-icon-mirror:before {
	content: "\\f10e";
}
.ptro-icon-open:before {
	content: "\\f10f";
}
.ptro-icon-painterro0:before {
	content: "\\f110";
}
.ptro-icon-paste_extend_down:before {
	content: "\\f111";
}
.ptro-icon-paste_extend_left:before {
	content: "\\f112";
}
.ptro-icon-paste_extend_right:before {
	content: "\\f113";
}
.ptro-icon-paste_extend_top:before {
	content: "\\f114";
}
.ptro-icon-paste_fit:before {
	content: "\\f115";
}
.ptro-icon-paste_over:before {
	content: "\\f116";
}
.ptro-icon-pipette:before {
	content: "\\f117";
}
.ptro-icon-pixelize:before {
	content: "\\f118";
}
.ptro-icon-rect:before {
	content: "\\f119";
}
.ptro-icon-redo:before {
	content: "\\f11a";
}
.ptro-icon-resize:before {
	content: "\\f11b";
}
.ptro-icon-rotate:before {
	content: "\\f11c";
}
.ptro-icon-save:before {
	content: "\\f11d";
}
.ptro-icon-select:before {
	content: "\\f11e";
}
.ptro-icon-settings:before {
	content: "\\f11f";
}
.ptro-icon-text:before {
	content: "\\f120";
}
.ptro-icon-undo:before {
	content: "\\f121";
}
.ptro-icon-unlinked:before {
	content: "\\f122";
}
.ptro-icon-zoomin:before {
	content: "\\f123";
}
.ptro-icon-zoomout:before {
	content: "\\f124";
}
`,"",{version:3,sources:["webpack://./css/icons/ptroiconfont.css"],names:[],mappings:"AAAA;CACC,2BAA2B;CAC3B;0DAC0E;CAC1E,mBAAmB;IAChB,kBAAkB;AACtB;;AAEA;AACA;;AAEA;CACC,oCAAoC;CACpC,6BAA6B;CAC7B,8BAA8B;CAC9B,+BAA+B;CAC/B,+BAA+B;CAC/B,WAAW;CACX,mCAAmC;CACnC,kCAAkC;AACnC;;AAEA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB;AACA;CACC,gBAAgB;AACjB",sourcesContent:[`@font-face {
	font-family: "ptroiconfont";
	src: url("ptroiconfont.woff?9d16276326db52747d3405a7ca0e1306") format("woff"),
url("ptroiconfont.ttf?9d16276326db52747d3405a7ca0e1306") format("truetype");
	font-weight: normal;
    font-style: normal;
}

.ptro-icon {
}

.ptro-icon:before {
	font-family: ptroiconfont !important;
	font-style: normal !important;
	font-weight: normal !important;
	font-variant: normal !important;
	text-transform: none !important;
	speak: none;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
}

.ptro-icon-apply:before {
	content: "\\f101";
}
.ptro-icon-arrow:before {
	content: "\\f102";
}
.ptro-icon-brush:before {
	content: "\\f103";
}
.ptro-icon-bucket:before {
	content: "\\f104";
}
.ptro-icon-clear:before {
	content: "\\f105";
}
.ptro-icon-close:before {
	content: "\\f106";
}
.ptro-icon-crop:before {
	content: "\\f107";
}
.ptro-icon-ellipse:before {
	content: "\\f108";
}
.ptro-icon-eraser:before {
	content: "\\f109";
}
.ptro-icon-filters:before {
	content: "\\f10a";
}
.ptro-icon-line:before {
	content: "\\f10b";
}
.ptro-icon-linked:before {
	content: "\\f10c";
}
.ptro-icon-loading:before {
	content: "\\f10d";
}
.ptro-icon-mirror:before {
	content: "\\f10e";
}
.ptro-icon-open:before {
	content: "\\f10f";
}
.ptro-icon-painterro0:before {
	content: "\\f110";
}
.ptro-icon-paste_extend_down:before {
	content: "\\f111";
}
.ptro-icon-paste_extend_left:before {
	content: "\\f112";
}
.ptro-icon-paste_extend_right:before {
	content: "\\f113";
}
.ptro-icon-paste_extend_top:before {
	content: "\\f114";
}
.ptro-icon-paste_fit:before {
	content: "\\f115";
}
.ptro-icon-paste_over:before {
	content: "\\f116";
}
.ptro-icon-pipette:before {
	content: "\\f117";
}
.ptro-icon-pixelize:before {
	content: "\\f118";
}
.ptro-icon-rect:before {
	content: "\\f119";
}
.ptro-icon-redo:before {
	content: "\\f11a";
}
.ptro-icon-resize:before {
	content: "\\f11b";
}
.ptro-icon-rotate:before {
	content: "\\f11c";
}
.ptro-icon-save:before {
	content: "\\f11d";
}
.ptro-icon-select:before {
	content: "\\f11e";
}
.ptro-icon-settings:before {
	content: "\\f11f";
}
.ptro-icon-text:before {
	content: "\\f120";
}
.ptro-icon-undo:before {
	content: "\\f121";
}
.ptro-icon-unlinked:before {
	content: "\\f122";
}
.ptro-icon-zoomin:before {
	content: "\\f123";
}
.ptro-icon-zoomout:before {
	content: "\\f124";
}
`],sourceRoot:""}]);let Q=dt},170:(O,_,S)=>{"use strict";S.d(_,{Z:()=>_t});var $=S(15),h=S.n($),U=S(645),it=S.n(U),et=S(667),bt=S.n(et),pt=S(122),ut=it()(h()),dt=bt()(pt.Z);ut.push([O.id,`.ptro-wrapper {\r
    position: absolute;\r
    top: 0;\r
    left: 0;\r
    right: 0;\r
    text-align: center;\r
    z-index: 10;\r
    font-family: "Open Sans", sans-serif;\r
}\r
\r
@media screen and (min-width: 869px) {\r
    .ptro-holder {\r
        position: fixed;\r
        left: 35px;\r
        right: 35px;\r
        top: 35px;\r
        bottom: 35px;\r
        box-shadow: 1px 1px 5px #888;\r
    }\r
}\r
\r
@media screen and (max-width: 868px) {\r
    .ptro-holder {\r
        position: fixed;\r
        box-shadow: 3px 3px 15px #787878;\r
        left: 0;\r
        right: 0;\r
        top: 0;\r
        bottom: 0;\r
    }\r
}\r
\r
.ptro-holder-wrapper {\r
    position: fixed;\r
    top: 0;\r
    left: 0;\r
    width: 100%;\r
    height: 100%;\r
    background-color: rgba(0,0,0,0.2);\r
}\r
\r
.ptro-wrapper.ptro-v-aligned:before {\r
    content: "";\r
    display: inline-block;\r
    vertical-align: middle;\r
    height: 100%;\r
}\r
\r
\r
.ptro-icon {\r
    font-size: 14px;\r
    display: flex;\r
    align-items: center;\r
    justify-content: center;\r
}\r
\r
\r
.ptro-icon-btn:disabled {\r
    color: gray;\r
}\r
\r
.ptro-wrapper canvas {\r
    /* vertical-align: middle; */\r
    display: inline-block;\r
    touch-action: none;\r
    margin-left: auto;\r
    margin-right: auto;\r
    width: auto;\r
    height: auto;\r
}\r
\r
.ptro-center-table {\r
    display:table;\r
    width: 100%;\r
    height: 100%;\r
}\r
\r
.ptro-center-tablecell {\r
    display:table-cell;\r
    vertical-align:middle;\r
}\r
\r
.ptro-icon-btn {\r
    border: 0;\r
    cursor: pointer;\r
    flex-shrink: 0;\r
    display: flex;\r
    align-items: center;\r
    justify-content: center;\r
}\r
\r
.ptro-icon-btn i {\r
}\r
\r
\r
.ptro-named-btn {\r
    border: 0;\r
    display: inline-block;\r
    height: 30px;\r
    margin-left: 4px;\r
    font-family: "Open Sans", sans-serif;\r
    position: relative;\r
    top:-5px;\r
    font-size: 14px;\r
    cursor: pointer;\r
}\r
\r
.ptro-icon-btn:focus,\r
.ptro-named-btn:focus,\r
.color-diwget-btn:focus,\r
.ptro-color-btn:focus,\r
.ptro-selector-btn:focus {\r
    outline: none;\r
}\r
\r
.ptro-color-btn {\r
    height: 32px;\r
    width: 32px;\r
    cursor: pointer;\r
}\r
\r
\r
.ptro-wrapper .select-handler {\r
    background-color: white;\r
    border: 1px solid black;\r
    width: 6px;\r
    height: 6px;\r
    position: absolute;\r
    z-index: 10;\r
}\r
\r
.ptro-wrapper .ptro-crp-el {\r
    position: absolute;\r
}\r
\r
.ptro-wrapper .ptro-substrate {\r
    opacity: 0.3;\r
    background-image: url(`+dt+`);\r
    background-size: 32px 32px;\r
    z-index: -1;\r
    position: absolute;\r
}\r
\r
.ptro-wrapper .ptro-close-color-picker {\r
    height: 24px;\r
    margin-top: 5px;\r
    margin-bottom: -5px;\r
    margin-left: auto;\r
}\r
\r
.ptro-tool-controls {\r
    flex-shrink: 0;\r
    display: flex;\r
    align-items: center;\r
}\r
\r
.ptro-wrapper .ptro-crp-rect {\r
    position: absolute;\r
    background-color: rgba(225, 225, 225, .5);\r
    border: 1px dashed black;\r
    cursor: move;\r
    -moz-user-select: none;\r
    /* -webkit-user-select: none; */\r
    -ms-user-select: none;\r
    user-select: none;\r
    -webkit-user-drag: none;\r
    user-drag: none;\r
    -webkit-touch-callout: none;\r
    background-repeat: no-repeat;\r
    background-size: 100% 100%;\r
}\r
\r
.ptro-wrapper .ptro-crp-tl {\r
    position: absolute;\r
    top: 0;\r
    left: 0;\r
    margin: -4px 0 0 -4px;\r
    cursor: se-resize;\r
}\r
\r
.ptro-wrapper .ptro-crp-bl {\r
    position: absolute;\r
    left: 0;\r
    bottom: 0;\r
    margin: 0 0 -4px -4px;\r
    cursor: ne-resize;\r
}\r
\r
.ptro-wrapper .ptro-crp-br {\r
    position: absolute;\r
    right: 0;\r
    bottom: 0;\r
    margin: 0 -4px -4px 0;\r
    cursor: se-resize;\r
}\r
\r
.ptro-wrapper .ptro-crp-tr {\r
    position: absolute;\r
    right: 0;\r
    top: 0;\r
    margin: -4px -4px 0 0;\r
    cursor: ne-resize;\r
}\r
\r
\r
.ptro-wrapper .ptro-crp-l {\r
    position: absolute;\r
    top: 50%;\r
    left: 0;\r
    margin: -4px 0 0 -4px;\r
    cursor: e-resize;\r
}\r
\r
.ptro-wrapper .ptro-crp-t {\r
    position: absolute;\r
    top: 0;\r
    left: 50%;\r
    margin: -4px 0 0 -4px;\r
    cursor: s-resize;\r
}\r
\r
.ptro-wrapper .ptro-crp-r {\r
    position: absolute;\r
    top: 50%;\r
    right: 0;\r
    margin: -4px -4px 0 0 ;\r
    cursor: e-resize;\r
}\r
\r
.ptro-wrapper .ptro-crp-b {\r
    position: absolute;\r
    left: 50%;\r
    bottom: 0;\r
    margin: 0 0 -4px -4px;\r
    cursor: s-resize;\r
}\r
\r
.ptro-wrapper div,\r
.ptro-wrapper span,\r
.ptro-wrapper i,\r
.ptro-bar .ptro-tool-ctl-name,\r
.ptro-bar input,\r
.ptro-bar .ptro-named-btn p {\r
    -moz-user-select: none;\r
   /* -webkit-user-select: none; */\r
    -ms-user-select: none;\r
    user-select: none;\r
    -webkit-user-drag: none;\r
    user-drag: none;\r
    -webkit-touch-callout: none;\r
}\r
\r
.ptro-bar > div {\r
    overflow-x: auto;\r
    overflow-y: hidden;\r
    height: 100%;\r
    display: flex;\r
    align-items: center;\r
}\r
\r
\r
\r
.ptro-wrapper .ptro-common-widget-wrapper {\r
    position: absolute;\r
    background-color: rgba(0, 0, 0, 0.6);\r
    top: 0;\r
    bottom: 0;\r
    left: 0;\r
    right: 0;\r
}\r
\r
.ptro-wrapper .ptro-pallet canvas {\r
    cursor: crosshair;\r
}\r
\r
div.ptro-pallet {\r
    line-height: 0;\r
}\r
\r
.ptro-wrapper .ptro-pallet,\r
.ptro-wrapper .ptro-resize-widget{\r
    width: 200px;\r
    padding: 10px;\r
    z-index: 100;\r
    box-sizing: border-box;\r
}\r
\r
.ptro-error {\r
    background-color: rgba(200, 0, 0, 0.5);\r
    padding: 5px;\r
    margin: 5px;\r
    color: white;\r
}\r
\r
.ptro-v-middle:before {\r
    content: "";\r
    display: inline-block;\r
    vertical-align: middle;\r
    height: 100%;\r
}\r
\r
.ptro-v-middle-in {\r
    display: inline-block;\r
    vertical-align: middle;\r
    position: relative;\r
}\r
\r
.ptro-wrapper .ptro-settings-widget {\r
    width: 300px;\r
    padding: 10px;\r
    z-index: 100;\r
    box-sizing: border-box;\r
}\r
\r
td.ptro-resize-table-left {\r
    text-align: right;\r
    padding-right: 5px;\r
    float: none;\r
    font-size: 14px;\r
}\r
\r
.ptro-wrapper .ptro-color-edit {\r
    margin-top: 15px;\r
}\r
\r
.ptro-wrapper .ptro-color-edit input {\r
    float: left;\r
    height: 24px;\r
    text-align: center;\r
    font-family: monospace;\r
    font-size: 14px;\r
}\r
\r
.ptro-wrapper .ptro-color-edit input:focus {\r
    outline: none;\r
}\r
\r
.ptro-wrapper .ptro-color-edit input.ptro-color {\r
    width: 70px;\r
}\r
\r
.ptro-wrapper .ptro-color-edit input.ptro-color-alpha {\r
    font-size: 14px;\r
    width: 55px;\r
    padding: 0 0 0 2px;\r
    line-height: 23px;\r
    height: 23px;\r
}\r
\r
.ptro-wrapper .ptro-color-alpha-label,\r
.ptro-wrapper .ptro-label  {\r
    float: left;\r
    padding: 0 2px 0 0;\r
    margin-left: 5px;\r
    font-family: "Open Sans", sans-serif;\r
}\r
\r
.ptro-pixel-size-input {\r
    width: 60px;\r
}\r
\r
.ptro-wrapper .ptro-pipette {\r
    height: 24px;\r
    width: 24px;\r
    margin: 0;\r
}\r
\r
div.ptro-color-widget-wrapper {\r
	z-index: 1000;\r
}\r
\r
.ptro-wrapper .ptro-pipette i {\r
    line-height: 16px;\r
}\r
\r
.ptro-wrapper .ptro-pipette:active {\r
    outline: none;\r
}\r
\r
.ptro-wrapper .ptro-color-widget-wrapper .ptro-canvas-light,\r
.ptro-wrapper .ptro-color-widget-wrapper .ptro-canvas-alpha {\r
    margin-top: 10px;\r
}\r
\r
span.ptro-color-light-regulator,\r
span.ptro-color-alpha-regulator {\r
    display: block;\r
    margin-top: -5px;\r
    margin-left: 5px;\r
    position: absolute;\r
    width: 0;\r
    height: 0;\r
    border-left: 5px solid transparent;\r
    border-right: 5px solid transparent;\r
    border-bottom: 5px solid;\r
    cursor: crosshair;\r
}\r
\r
span.ptro-color-alpha-regulator {\r
    margin-top: 0;\r
}\r
\r
.alpha-checkers {\r
    background-image: url(`+dt+`);\r
    display: block;\r
    width: 100%;\r
    height: 15px;\r
    background-size: 10px 10px;\r
    margin-top: -20px;\r
}\r
\r
input.ptro-input:focus,\r
select.ptro-input:focus {\r
    outline: none;\r
    box-shadow: none ;\r
}\r
\r
input.ptro-input,\r
select.ptro-input {\r
    vertical-align: initial;\r
    padding-top: 0;\r
    padding-bottom: 0;\r
    padding-right: 0;\r
}\r
\r
.ptro-named-btn p {\r
    font-size: inherit;\r
    line-height: normal;\r
    margin: inherit;\r
}\r
\r
.ptro-wrapper .ptro-zoomer {\r
    border-top:1px solid white;\r
    border-left:1px solid white;\r
    position: absolute;\r
    z-index: 2000;\r
    display: none;\r
}\r
\r
.ptro-text-tool-input {\r
    background-color: rgba(0,0,0,0);\r
    width: auto;\r
    outline: 1px dotted;\r
    display: block;\r
    min-width: 5px;\r
    padding: 0 1px;\r
    overflow-x: hidden;\r
    word-wrap: break-word;\r
    overflow-y: hidden;\r
    box-sizing: content-box;\r
    line-height: normal;\r
    text-align: left;\r
}\r
.ptro-paster-wrappers-fits {\r
    display: flex;\r
    justify-content: space-around;\r
    align-items: center;\r
}\r
.ptro-selector-extend[type] {\r
    height: 70px;\r
    width: 70px;\r
}\r
.ptro-selector-extend div:last-child {\r
    display: none;\r
}\r
.ptro-selector-fit[type] {\r
    height: 220px;\r
    width: 220px;\r
    margin: 0px;\r
}\r
.ptro-paster-fit[class] {\r
    margin-right: 46px;\r
}\r
.ptro-text-tool-buttons {\r
    display: flex;\r
    position: absolute;\r
}\r
.ptro-text-tool-input-wrapper {\r
    position: absolute;\r
}\r
\r
span.ptro-btn-color-checkers {\r
    background-image: url(`+dt+`);\r
    display: block;\r
    width: 32px;\r
    height: 32px;\r
    background-size: 16px 16px;\r
    margin-top: -32px;\r
}\r
\r
span.ptro-btn-color-checkers-bar {\r
    background-image: url(`+dt+`);\r
    width: 32px;\r
    line-height: 12px;\r
    height: 32px;\r
    background-size: 16px 16px;\r
    z-index: 0;\r
    position: relative;\r
    margin-left: -32px;\r
}\r
\r
.ptro-bar-right {\r
    display: flex;\r
\r
}\r
\r
.ptro-link {\r
    float: left;\r
    margin-right: -12px;\r
    margin-top: -23px;\r
}\r
\r
.ptro-resize-link-wrapper {\r
    display: inline-block;\r
    height: 40px;\r
}\r
\r
\r
input.ptro-resize-width-input,\r
input.ptro-resize-heigth-input,\r
input.ptro-pixel-size-input {\r
    line-height: 22px;\r
    padding: 0 0 0 4px;\r
    height: 22px;\r
    width: 80px;\r
}\r
\r
.ptro-selector-btn i {\r
    font-size: 56px;\r
}\r
\r
.ptro-selector-btn {\r
    opacity: 0.8;\r
    border: 0;\r
    width: 100px;\r
    cursor: pointer;\r
}\r
\r
.ptro-selector-btn {\r
    margin-left: 5px;\r
    margin-right: 5px;\r
    margin-top: 5px;\r
    margin-bottom: 5px;\r
}\r
\r
.ptro-selector-btn div {\r
    margin: 5px 0;\r
}\r
\r
.ptro-paster-select .ptro-in div {\r
    font-family: "Open Sans", sans-serif;\r
    font-size: 14px;\r
}\r
\r
.ptro-selector-btn:hover {\r
    opacity: 0.6;\r
}\r
\r
.ptro-paster-select {\r
    display: inline-block;\r
    margin-left: auto;\r
    margin-right: auto;\r
    height: 100%;\r
}\r
\r
.ptro-paster-select .ptro-in {\r
    background-color: rgba(0,0,0,0.7);\r
    padding: 40px;\r
}\r
.ptro-paster-select-wrapper {\r
    position: absolute;\r
    top: 0;\r
    left: 0;\r
    right: 0;\r
    bottom: 0;\r
}\r
.ptro-paster-select-wrapper-extends button:first-child {\r
    display: block;\r
    margin: 0 auto;\r
}\r
.ptro-paster-select-wrapper-extends button:last-child{\r
    display: block;\r
    margin: 0 auto;\r
}\r
.ptro-paster-select-wrapper-extends button:nth-child(2){\r
    display: inline-block;\r
    margin-right: 78px;\r
}\r
.ptro-paster-fit .ptro-paster-wrapper-label[class] {\r
    display: block; \r
    color: white;\r
    font-size: 20px;\r
    text-align: center;\r
    margin-top: 10px;\r
    text-transform: uppercase;\r
}\r
.ptro-paster-select-wrapper-extends .ptro-paster-wrapper-label[class] {\r
    display: block; \r
    color: white;\r
    font-size: 20px;\r
    text-align: center;\r
    margin-top: 10px;\r
    text-transform: uppercase;\r
}\r
.ptro-paste-label {\r
    color: white;\r
    margin-bottom: 10px;\r
}\r
\r
.ptro-iframe {\r
    width: 100%;\r
    height: 100%;\r
    border: 0;\r
}\r
\r
\r
\r
i.mce-i-painterro:before, span.mce_painterro:before {\r
	font-size: 20px;\r
	font-family: ptroiconfont;\r
	font-style: normal;\r
	font-weight: normal;\r
	font-variant: normal;\r
	text-transform: none;\r
	speak: none;\r
	-webkit-font-smoothing: antialiased;\r
	-moz-osx-font-smoothing: grayscale;\r
	content: "\\f101";\r
}\r
\r
.ptro-scroller {\r
    position: absolute;\r
    top: 0;\r
    left: 0;\r
    right: 0;\r
    bottom: 0;\r
}\r
\r
td.ptro-strict-cell {\r
    font-size: 8px;\r
    line-height: normal;\r
}`,"",{version:3,sources:["webpack://./css/styles.css"],names:[],mappings:"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",sourcesContent:[`.ptro-wrapper {\r
    position: absolute;\r
    top: 0;\r
    left: 0;\r
    right: 0;\r
    text-align: center;\r
    z-index: 10;\r
    font-family: "Open Sans", sans-serif;\r
}\r
\r
@media screen and (min-width: 869px) {\r
    .ptro-holder {\r
        position: fixed;\r
        left: 35px;\r
        right: 35px;\r
        top: 35px;\r
        bottom: 35px;\r
        box-shadow: 1px 1px 5px #888;\r
    }\r
}\r
\r
@media screen and (max-width: 868px) {\r
    .ptro-holder {\r
        position: fixed;\r
        box-shadow: 3px 3px 15px #787878;\r
        left: 0;\r
        right: 0;\r
        top: 0;\r
        bottom: 0;\r
    }\r
}\r
\r
.ptro-holder-wrapper {\r
    position: fixed;\r
    top: 0;\r
    left: 0;\r
    width: 100%;\r
    height: 100%;\r
    background-color: rgba(0,0,0,0.2);\r
}\r
\r
.ptro-wrapper.ptro-v-aligned:before {\r
    content: "";\r
    display: inline-block;\r
    vertical-align: middle;\r
    height: 100%;\r
}\r
\r
\r
.ptro-icon {\r
    font-size: 14px;\r
    display: flex;\r
    align-items: center;\r
    justify-content: center;\r
}\r
\r
\r
.ptro-icon-btn:disabled {\r
    color: gray;\r
}\r
\r
.ptro-wrapper canvas {\r
    /* vertical-align: middle; */\r
    display: inline-block;\r
    touch-action: none;\r
    margin-left: auto;\r
    margin-right: auto;\r
    width: auto;\r
    height: auto;\r
}\r
\r
.ptro-center-table {\r
    display:table;\r
    width: 100%;\r
    height: 100%;\r
}\r
\r
.ptro-center-tablecell {\r
    display:table-cell;\r
    vertical-align:middle;\r
}\r
\r
.ptro-icon-btn {\r
    border: 0;\r
    cursor: pointer;\r
    flex-shrink: 0;\r
    display: flex;\r
    align-items: center;\r
    justify-content: center;\r
}\r
\r
.ptro-icon-btn i {\r
}\r
\r
\r
.ptro-named-btn {\r
    border: 0;\r
    display: inline-block;\r
    height: 30px;\r
    margin-left: 4px;\r
    font-family: "Open Sans", sans-serif;\r
    position: relative;\r
    top:-5px;\r
    font-size: 14px;\r
    cursor: pointer;\r
}\r
\r
.ptro-icon-btn:focus,\r
.ptro-named-btn:focus,\r
.color-diwget-btn:focus,\r
.ptro-color-btn:focus,\r
.ptro-selector-btn:focus {\r
    outline: none;\r
}\r
\r
.ptro-color-btn {\r
    height: 32px;\r
    width: 32px;\r
    cursor: pointer;\r
}\r
\r
\r
.ptro-wrapper .select-handler {\r
    background-color: white;\r
    border: 1px solid black;\r
    width: 6px;\r
    height: 6px;\r
    position: absolute;\r
    z-index: 10;\r
}\r
\r
.ptro-wrapper .ptro-crp-el {\r
    position: absolute;\r
}\r
\r
.ptro-wrapper .ptro-substrate {\r
    opacity: 0.3;\r
    background-image: url("checkers.svg");\r
    background-size: 32px 32px;\r
    z-index: -1;\r
    position: absolute;\r
}\r
\r
.ptro-wrapper .ptro-close-color-picker {\r
    height: 24px;\r
    margin-top: 5px;\r
    margin-bottom: -5px;\r
    margin-left: auto;\r
}\r
\r
.ptro-tool-controls {\r
    flex-shrink: 0;\r
    display: flex;\r
    align-items: center;\r
}\r
\r
.ptro-wrapper .ptro-crp-rect {\r
    position: absolute;\r
    background-color: rgba(225, 225, 225, .5);\r
    border: 1px dashed black;\r
    cursor: move;\r
    -moz-user-select: none;\r
    /* -webkit-user-select: none; */\r
    -ms-user-select: none;\r
    user-select: none;\r
    -webkit-user-drag: none;\r
    user-drag: none;\r
    -webkit-touch-callout: none;\r
    background-repeat: no-repeat;\r
    background-size: 100% 100%;\r
}\r
\r
.ptro-wrapper .ptro-crp-tl {\r
    position: absolute;\r
    top: 0;\r
    left: 0;\r
    margin: -4px 0 0 -4px;\r
    cursor: se-resize;\r
}\r
\r
.ptro-wrapper .ptro-crp-bl {\r
    position: absolute;\r
    left: 0;\r
    bottom: 0;\r
    margin: 0 0 -4px -4px;\r
    cursor: ne-resize;\r
}\r
\r
.ptro-wrapper .ptro-crp-br {\r
    position: absolute;\r
    right: 0;\r
    bottom: 0;\r
    margin: 0 -4px -4px 0;\r
    cursor: se-resize;\r
}\r
\r
.ptro-wrapper .ptro-crp-tr {\r
    position: absolute;\r
    right: 0;\r
    top: 0;\r
    margin: -4px -4px 0 0;\r
    cursor: ne-resize;\r
}\r
\r
\r
.ptro-wrapper .ptro-crp-l {\r
    position: absolute;\r
    top: 50%;\r
    left: 0;\r
    margin: -4px 0 0 -4px;\r
    cursor: e-resize;\r
}\r
\r
.ptro-wrapper .ptro-crp-t {\r
    position: absolute;\r
    top: 0;\r
    left: 50%;\r
    margin: -4px 0 0 -4px;\r
    cursor: s-resize;\r
}\r
\r
.ptro-wrapper .ptro-crp-r {\r
    position: absolute;\r
    top: 50%;\r
    right: 0;\r
    margin: -4px -4px 0 0 ;\r
    cursor: e-resize;\r
}\r
\r
.ptro-wrapper .ptro-crp-b {\r
    position: absolute;\r
    left: 50%;\r
    bottom: 0;\r
    margin: 0 0 -4px -4px;\r
    cursor: s-resize;\r
}\r
\r
.ptro-wrapper div,\r
.ptro-wrapper span,\r
.ptro-wrapper i,\r
.ptro-bar .ptro-tool-ctl-name,\r
.ptro-bar input,\r
.ptro-bar .ptro-named-btn p {\r
    -moz-user-select: none;\r
   /* -webkit-user-select: none; */\r
    -ms-user-select: none;\r
    user-select: none;\r
    -webkit-user-drag: none;\r
    user-drag: none;\r
    -webkit-touch-callout: none;\r
}\r
\r
.ptro-bar > div {\r
    overflow-x: auto;\r
    overflow-y: hidden;\r
    height: 100%;\r
    display: flex;\r
    align-items: center;\r
}\r
\r
\r
\r
.ptro-wrapper .ptro-common-widget-wrapper {\r
    position: absolute;\r
    background-color: rgba(0, 0, 0, 0.6);\r
    top: 0;\r
    bottom: 0;\r
    left: 0;\r
    right: 0;\r
}\r
\r
.ptro-wrapper .ptro-pallet canvas {\r
    cursor: crosshair;\r
}\r
\r
div.ptro-pallet {\r
    line-height: 0;\r
}\r
\r
.ptro-wrapper .ptro-pallet,\r
.ptro-wrapper .ptro-resize-widget{\r
    width: 200px;\r
    padding: 10px;\r
    z-index: 100;\r
    box-sizing: border-box;\r
}\r
\r
.ptro-error {\r
    background-color: rgba(200, 0, 0, 0.5);\r
    padding: 5px;\r
    margin: 5px;\r
    color: white;\r
}\r
\r
.ptro-v-middle:before {\r
    content: "";\r
    display: inline-block;\r
    vertical-align: middle;\r
    height: 100%;\r
}\r
\r
.ptro-v-middle-in {\r
    display: inline-block;\r
    vertical-align: middle;\r
    position: relative;\r
}\r
\r
.ptro-wrapper .ptro-settings-widget {\r
    width: 300px;\r
    padding: 10px;\r
    z-index: 100;\r
    box-sizing: border-box;\r
}\r
\r
td.ptro-resize-table-left {\r
    text-align: right;\r
    padding-right: 5px;\r
    float: none;\r
    font-size: 14px;\r
}\r
\r
.ptro-wrapper .ptro-color-edit {\r
    margin-top: 15px;\r
}\r
\r
.ptro-wrapper .ptro-color-edit input {\r
    float: left;\r
    height: 24px;\r
    text-align: center;\r
    font-family: monospace;\r
    font-size: 14px;\r
}\r
\r
.ptro-wrapper .ptro-color-edit input:focus {\r
    outline: none;\r
}\r
\r
.ptro-wrapper .ptro-color-edit input.ptro-color {\r
    width: 70px;\r
}\r
\r
.ptro-wrapper .ptro-color-edit input.ptro-color-alpha {\r
    font-size: 14px;\r
    width: 55px;\r
    padding: 0 0 0 2px;\r
    line-height: 23px;\r
    height: 23px;\r
}\r
\r
.ptro-wrapper .ptro-color-alpha-label,\r
.ptro-wrapper .ptro-label  {\r
    float: left;\r
    padding: 0 2px 0 0;\r
    margin-left: 5px;\r
    font-family: "Open Sans", sans-serif;\r
}\r
\r
.ptro-pixel-size-input {\r
    width: 60px;\r
}\r
\r
.ptro-wrapper .ptro-pipette {\r
    height: 24px;\r
    width: 24px;\r
    margin: 0;\r
}\r
\r
div.ptro-color-widget-wrapper {\r
	z-index: 1000;\r
}\r
\r
.ptro-wrapper .ptro-pipette i {\r
    line-height: 16px;\r
}\r
\r
.ptro-wrapper .ptro-pipette:active {\r
    outline: none;\r
}\r
\r
.ptro-wrapper .ptro-color-widget-wrapper .ptro-canvas-light,\r
.ptro-wrapper .ptro-color-widget-wrapper .ptro-canvas-alpha {\r
    margin-top: 10px;\r
}\r
\r
span.ptro-color-light-regulator,\r
span.ptro-color-alpha-regulator {\r
    display: block;\r
    margin-top: -5px;\r
    margin-left: 5px;\r
    position: absolute;\r
    width: 0;\r
    height: 0;\r
    border-left: 5px solid transparent;\r
    border-right: 5px solid transparent;\r
    border-bottom: 5px solid;\r
    cursor: crosshair;\r
}\r
\r
span.ptro-color-alpha-regulator {\r
    margin-top: 0;\r
}\r
\r
.alpha-checkers {\r
    background-image: url("checkers.svg");\r
    display: block;\r
    width: 100%;\r
    height: 15px;\r
    background-size: 10px 10px;\r
    margin-top: -20px;\r
}\r
\r
input.ptro-input:focus,\r
select.ptro-input:focus {\r
    outline: none;\r
    box-shadow: none ;\r
}\r
\r
input.ptro-input,\r
select.ptro-input {\r
    vertical-align: initial;\r
    padding-top: 0;\r
    padding-bottom: 0;\r
    padding-right: 0;\r
}\r
\r
.ptro-named-btn p {\r
    font-size: inherit;\r
    line-height: normal;\r
    margin: inherit;\r
}\r
\r
.ptro-wrapper .ptro-zoomer {\r
    border-top:1px solid white;\r
    border-left:1px solid white;\r
    position: absolute;\r
    z-index: 2000;\r
    display: none;\r
}\r
\r
.ptro-text-tool-input {\r
    background-color: rgba(0,0,0,0);\r
    width: auto;\r
    outline: 1px dotted;\r
    display: block;\r
    min-width: 5px;\r
    padding: 0 1px;\r
    overflow-x: hidden;\r
    word-wrap: break-word;\r
    overflow-y: hidden;\r
    box-sizing: content-box;\r
    line-height: normal;\r
    text-align: left;\r
}\r
.ptro-paster-wrappers-fits {\r
    display: flex;\r
    justify-content: space-around;\r
    align-items: center;\r
}\r
.ptro-selector-extend[type] {\r
    height: 70px;\r
    width: 70px;\r
}\r
.ptro-selector-extend div:last-child {\r
    display: none;\r
}\r
.ptro-selector-fit[type] {\r
    height: 220px;\r
    width: 220px;\r
    margin: 0px;\r
}\r
.ptro-paster-fit[class] {\r
    margin-right: 46px;\r
}\r
.ptro-text-tool-buttons {\r
    display: flex;\r
    position: absolute;\r
}\r
.ptro-text-tool-input-wrapper {\r
    position: absolute;\r
}\r
\r
span.ptro-btn-color-checkers {\r
    background-image: url("checkers.svg");\r
    display: block;\r
    width: 32px;\r
    height: 32px;\r
    background-size: 16px 16px;\r
    margin-top: -32px;\r
}\r
\r
span.ptro-btn-color-checkers-bar {\r
    background-image: url("checkers.svg");\r
    width: 32px;\r
    line-height: 12px;\r
    height: 32px;\r
    background-size: 16px 16px;\r
    z-index: 0;\r
    position: relative;\r
    margin-left: -32px;\r
}\r
\r
.ptro-bar-right {\r
    display: flex;\r
\r
}\r
\r
.ptro-link {\r
    float: left;\r
    margin-right: -12px;\r
    margin-top: -23px;\r
}\r
\r
.ptro-resize-link-wrapper {\r
    display: inline-block;\r
    height: 40px;\r
}\r
\r
\r
input.ptro-resize-width-input,\r
input.ptro-resize-heigth-input,\r
input.ptro-pixel-size-input {\r
    line-height: 22px;\r
    padding: 0 0 0 4px;\r
    height: 22px;\r
    width: 80px;\r
}\r
\r
.ptro-selector-btn i {\r
    font-size: 56px;\r
}\r
\r
.ptro-selector-btn {\r
    opacity: 0.8;\r
    border: 0;\r
    width: 100px;\r
    cursor: pointer;\r
}\r
\r
.ptro-selector-btn {\r
    margin-left: 5px;\r
    margin-right: 5px;\r
    margin-top: 5px;\r
    margin-bottom: 5px;\r
}\r
\r
.ptro-selector-btn div {\r
    margin: 5px 0;\r
}\r
\r
.ptro-paster-select .ptro-in div {\r
    font-family: "Open Sans", sans-serif;\r
    font-size: 14px;\r
}\r
\r
.ptro-selector-btn:hover {\r
    opacity: 0.6;\r
}\r
\r
.ptro-paster-select {\r
    display: inline-block;\r
    margin-left: auto;\r
    margin-right: auto;\r
    height: 100%;\r
}\r
\r
.ptro-paster-select .ptro-in {\r
    background-color: rgba(0,0,0,0.7);\r
    padding: 40px;\r
}\r
.ptro-paster-select-wrapper {\r
    position: absolute;\r
    top: 0;\r
    left: 0;\r
    right: 0;\r
    bottom: 0;\r
}\r
.ptro-paster-select-wrapper-extends button:first-child {\r
    display: block;\r
    margin: 0 auto;\r
}\r
.ptro-paster-select-wrapper-extends button:last-child{\r
    display: block;\r
    margin: 0 auto;\r
}\r
.ptro-paster-select-wrapper-extends button:nth-child(2){\r
    display: inline-block;\r
    margin-right: 78px;\r
}\r
.ptro-paster-fit .ptro-paster-wrapper-label[class] {\r
    display: block; \r
    color: white;\r
    font-size: 20px;\r
    text-align: center;\r
    margin-top: 10px;\r
    text-transform: uppercase;\r
}\r
.ptro-paster-select-wrapper-extends .ptro-paster-wrapper-label[class] {\r
    display: block; \r
    color: white;\r
    font-size: 20px;\r
    text-align: center;\r
    margin-top: 10px;\r
    text-transform: uppercase;\r
}\r
.ptro-paste-label {\r
    color: white;\r
    margin-bottom: 10px;\r
}\r
\r
.ptro-iframe {\r
    width: 100%;\r
    height: 100%;\r
    border: 0;\r
}\r
\r
\r
\r
i.mce-i-painterro:before, span.mce_painterro:before {\r
	font-size: 20px;\r
	font-family: ptroiconfont;\r
	font-style: normal;\r
	font-weight: normal;\r
	font-variant: normal;\r
	text-transform: none;\r
	speak: none;\r
	-webkit-font-smoothing: antialiased;\r
	-moz-osx-font-smoothing: grayscale;\r
	content: "\\f101";\r
}\r
\r
.ptro-scroller {\r
    position: absolute;\r
    top: 0;\r
    left: 0;\r
    right: 0;\r
    bottom: 0;\r
}\r
\r
td.ptro-strict-cell {\r
    font-size: 8px;\r
    line-height: normal;\r
}`],sourceRoot:""}]);let _t=ut},645:O=>{"use strict";O.exports=function(_){var S=[];return S.toString=function(){return this.map((function($){var h=_($);return $[2]?"@media ".concat($[2]," {").concat(h,"}"):h})).join("")},S.i=function($,h,U){typeof $=="string"&&($=[[null,$,""]]);var it={};if(U)for(var et=0;et<this.length;et++){var bt=this[et][0];bt!=null&&(it[bt]=!0)}for(var pt=0;pt<$.length;pt++){var ut=[].concat($[pt]);U&&it[ut[0]]||(h&&(ut[2]?ut[2]="".concat(h," and ").concat(ut[2]):ut[2]=h),S.push(ut))}},S}},15:O=>{"use strict";function _($,h){return(function(U){if(Array.isArray(U))return U})($)||(function(U,it){if(!(typeof Symbol>"u"||!(Symbol.iterator in Object(U)))){var et=[],bt=!0,pt=!1,ut=void 0;try{for(var dt,_t=U[Symbol.iterator]();!(bt=(dt=_t.next()).done)&&(et.push(dt.value),!it||et.length!==it);bt=!0);}catch(H){pt=!0,ut=H}finally{try{bt||_t.return==null||_t.return()}finally{if(pt)throw ut}}return et}})($,h)||(function(U,it){if(U){if(typeof U=="string")return S(U,it);var et=Object.prototype.toString.call(U).slice(8,-1);if(et==="Object"&&U.constructor&&(et=U.constructor.name),et==="Map"||et==="Set")return Array.from(U);if(et==="Arguments"||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(et))return S(U,it)}})($,h)||(function(){throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)})()}function S($,h){(h==null||h>$.length)&&(h=$.length);for(var U=0,it=new Array(h);U<h;U++)it[U]=$[U];return it}O.exports=function($){var h=_($,4),U=h[1],it=h[3];if(typeof btoa=="function"){var et=btoa(unescape(encodeURIComponent(JSON.stringify(it)))),bt="sourceMappingURL=data:application/json;charset=utf-8;base64,".concat(et),pt="/*# ".concat(bt," */"),ut=it.sources.map((function(dt){return"/*# sourceURL=".concat(it.sourceRoot||"").concat(dt," */")}));return[U].concat(ut).concat([pt]).join(`
`)}return[U].join(`
`)}},667:O=>{"use strict";O.exports=function(_,S){return S||(S={}),typeof(_=_&&_.__esModule?_.default:_)!="string"?_:(/^['"].*['"]$/.test(_)&&(_=_.slice(1,-1)),S.hash&&(_+=S.hash),/["'() \t\n]/.test(_)||S.needQuotes?'"'.concat(_.replace(/"/g,'\\"').replace(/\n/g,"\\n"),'"'):_)}},306:function(O){(function(_){"use strict";var S=(function(){return{escape:function(F){return F.replace(/([.*+?^${}()|\[\]\/\\])/g,"\\$1")},parseExtension:Q,mimeType:function(F){var b=Q(F).toLowerCase();return(B="application/font-woff",z="image/jpeg",{woff:B,woff2:B,ttf:"application/font-truetype",eot:"application/vnd.ms-fontobject",png:"image/png",jpg:z,jpeg:z,gif:"image/gif",tiff:"image/tiff",svg:"image/svg+xml"})[b]||"";var B,z},dataAsUrl:function(F,b){return"data:"+b+";base64,"+F},isDataUrl:function(F){return F.search(/^(data:)/)!==-1},canvasToBlob:function(F){return F.toBlob?new Promise((function(b){F.toBlob(b)})):(function(b){return new Promise((function(B){for(var z=window.atob(b.toDataURL().split(",")[1]),Y=z.length,Z=new Uint8Array(Y),rt=0;rt<Y;rt++)Z[rt]=z.charCodeAt(rt);B(new Blob([Z],{type:"image/png"}))}))})(F)},resolveUrl:function(F,b){var B=document.implementation.createHTMLDocument(),z=B.createElement("base");B.head.appendChild(z);var Y=B.createElement("a");return B.body.appendChild(Y),z.href=b,Y.href=F,Y.href},getAndEncode:function(F){var b=3e4;return et.impl.options.cacheBust&&(F+=(/\?/.test(F)?"&":"?")+new Date().getTime()),new Promise((function(B){var z,Y=new XMLHttpRequest;if(Y.onreadystatechange=rt,Y.ontimeout=lt,Y.responseType="blob",Y.timeout=b,Y.open("GET",F,!0),Y.send(),et.impl.options.imagePlaceholder){var Z=et.impl.options.imagePlaceholder.split(/,/);Z&&Z[1]&&(z=Z[1])}function rt(){if(Y.readyState===4)if(Y.status===200){var At=new FileReader;At.onloadend=function(){var Lt=At.result.split(/,/)[1];B(Lt)},At.readAsDataURL(Y.response)}else z?B(z):gt("cannot fetch resource: "+F+", status: "+Y.status)}function lt(){z?B(z):gt("timeout of "+b+"ms occured while fetching resource: "+F)}function gt(At){console.error(At),B("")}}))},uid:(H=0,function(){return"u"+F()+H++;function F(){return("0000"+(Math.random()*Math.pow(36,4)<<0).toString(36)).slice(-4)}}),delay:function(F){return function(b){return new Promise((function(B){setTimeout((function(){B(b)}),F)}))}},asArray:function(F){for(var b=[],B=F.length,z=0;z<B;z++)b.push(F[z]);return b},escapeXhtml:function(F){return F.replace(/#/g,"%23").replace(/\n/g,"%0A")},makeImage:function(F){return new Promise((function(b,B){var z=new Image;z.onload=function(){b(z)},z.onerror=B,z.src=F}))},width:function(F){var b=D(F,"border-left-width"),B=D(F,"border-right-width");return F.scrollWidth+b+B},height:function(F){var b=D(F,"border-top-width"),B=D(F,"border-bottom-width");return F.scrollHeight+b+B}};var H;function Q(F){var b=/\.([^\.\/]*?)$/g.exec(F);return b?b[1]:""}function D(F,b){var B=window.getComputedStyle(F).getPropertyValue(b);return parseFloat(B.replace("px",""))}})(),$=(function(){var H=/url\(['"]?([^'"]+?)['"]?\)/g;return{inlineAll:function(b,B,z){return Y()?Promise.resolve(b):Promise.resolve(b).then(D).then((function(Z){var rt=Promise.resolve(b);return Z.forEach((function(lt){rt=rt.then((function(gt){return F(gt,lt,B,z)}))})),rt}));function Y(){return!Q(b)}},shouldProcess:Q,impl:{readUrls:D,inline:F}};function Q(b){return b.search(H)!==-1}function D(b){for(var B,z=[];(B=H.exec(b))!==null;)z.push(B[1]);return z.filter((function(Y){return!S.isDataUrl(Y)}))}function F(b,B,z,Y){return Promise.resolve(B).then((function(Z){return z?S.resolveUrl(Z,z):Z})).then(Y||S.getAndEncode).then((function(Z){return S.dataAsUrl(Z,S.mimeType(B))})).then((function(Z){return b.replace((function(rt){return new RegExp(`(url\\(['"]?)(`+S.escape(rt)+`)(['"]?\\))`,"g")})(B),"$1"+Z+"$3")}))}})(),h=(function(){return{resolveAll:function(){return H(document).then((function(Q){return Promise.all(Q.map((function(D){return D.resolve()})))})).then((function(Q){return Q.join(`
`)}))},impl:{readAll:H}};function H(){return Promise.resolve(S.asArray(document.styleSheets)).then((function(D){var F=[];return D.forEach((function(b){try{S.asArray(b.cssRules||[]).forEach(F.push.bind(F))}catch(B){console.log("Error while reading CSS rules from "+b.href,B.toString())}})),F})).then((function(D){return D.filter((function(F){return F.type===CSSRule.FONT_FACE_RULE})).filter((function(F){return $.shouldProcess(F.style.getPropertyValue("src"))}))})).then((function(D){return D.map(Q)}));function Q(D){return{resolve:function(){var F=(D.parentStyleSheet||{}).href;return $.inlineAll(D.cssText,F)},src:function(){return D.style.getPropertyValue("src")}}}}})(),U=(function(){return{inlineAll:function Q(D){return D instanceof Element?F(D).then((function(){return D instanceof HTMLImageElement?H(D).inline():Promise.all(S.asArray(D.childNodes).map((function(b){return Q(b)})))})):Promise.resolve(D);function F(b){var B=b.style.getPropertyValue("background");return B?$.inlineAll(B).then((function(z){b.style.setProperty("background",z,b.style.getPropertyPriority("background"))})).then((function(){return b})):Promise.resolve(b)}},impl:{newImage:H}};function H(Q){return{inline:function(D){return S.isDataUrl(Q.src)?Promise.resolve():Promise.resolve(Q.src).then(D||S.getAndEncode).then((function(F){return S.dataAsUrl(F,S.mimeType(Q.src))})).then((function(F){return new Promise((function(b,B){Q.onload=b,Q.onerror=B,Q.src=F}))}))}}}})(),it={imagePlaceholder:void 0,cacheBust:!1},et={toSvg:bt,toPng:function(H,Q){return pt(H,Q||{}).then((function(D){return D.toDataURL()}))},toJpeg:function(H,Q){return pt(H,Q=Q||{}).then((function(D){return D.toDataURL("image/jpeg",Q.quality||1)}))},toBlob:function(H,Q){return pt(H,Q||{}).then(S.canvasToBlob)},toPixelData:function(H,Q){return pt(H,Q||{}).then((function(D){return D.getContext("2d").getImageData(0,0,S.width(H),S.height(H)).data}))},impl:{fontFaces:h,images:U,util:S,inliner:$,options:{}}};function bt(H,Q){return(function(D){D.imagePlaceholder===void 0?et.impl.options.imagePlaceholder=it.imagePlaceholder:et.impl.options.imagePlaceholder=D.imagePlaceholder,D.cacheBust===void 0?et.impl.options.cacheBust=it.cacheBust:et.impl.options.cacheBust=D.cacheBust})(Q=Q||{}),Promise.resolve(H).then((function(D){return ut(D,Q.filter,!0)})).then(dt).then(_t).then((function(D){return Q.bgcolor&&(D.style.backgroundColor=Q.bgcolor),Q.width&&(D.style.width=Q.width+"px"),Q.height&&(D.style.height=Q.height+"px"),Q.style&&Object.keys(Q.style).forEach((function(F){D.style[F]=Q.style[F]})),D})).then((function(D){return(function(F,b,B){return Promise.resolve(F).then((function(z){return z.setAttribute("xmlns","http://www.w3.org/1999/xhtml"),new XMLSerializer().serializeToString(z)})).then(S.escapeXhtml).then((function(z){return'<foreignObject x="0" y="0" width="100%" height="100%">'+z+"</foreignObject>"})).then((function(z){return'<svg xmlns="http://www.w3.org/2000/svg" width="'+b+'" height="'+B+'">'+z+"</svg>"})).then((function(z){return"data:image/svg+xml;charset=utf-8,"+z}))})(D,Q.width||S.width(H),Q.height||S.height(H))}))}function pt(H,Q){return bt(H,Q).then(S.makeImage).then(S.delay(100)).then((function(D){var F=(function(b){var B=document.createElement("canvas");if(B.width=Q.width||S.width(b),B.height=Q.height||S.height(b),Q.bgcolor){var z=B.getContext("2d");z.fillStyle=Q.bgcolor,z.fillRect(0,0,B.width,B.height)}return B})(H);return F.getContext("2d").drawImage(D,0,0),F}))}function ut(H,Q,D){return D||!Q||Q(H)?Promise.resolve(H).then((function(F){return F instanceof HTMLCanvasElement?S.makeImage(F.toDataURL()):F.cloneNode(!1)})).then((function(F){return(function(b,B,z){var Y=b.childNodes;return Y.length===0?Promise.resolve(B):Z(B,S.asArray(Y),z).then((function(){return B}));function Z(rt,lt,gt){var At=Promise.resolve();return lt.forEach((function(Lt){At=At.then((function(){return ut(Lt,gt)})).then((function(St){St&&rt.appendChild(St)}))})),At}})(H,F,Q)})).then((function(F){return(function(b,B){return B instanceof Element?Promise.resolve().then(z).then(Y).then(Z).then(rt).then((function(){return B})):B;function z(){function lt(gt,At){function Lt(St,$t){S.asArray(St).forEach((function(ne){$t.setProperty(ne,St.getPropertyValue(ne),St.getPropertyPriority(ne))}))}gt.cssText?At.cssText=gt.cssText:Lt(gt,At)}lt(window.getComputedStyle(b),B.style)}function Y(){function lt(gt){var At=window.getComputedStyle(b,gt),Lt=At.getPropertyValue("content");if(Lt!==""&&Lt!=="none"){var St=S.uid();B.className=B.className+" "+St;var $t=document.createElement("style");$t.appendChild(ne(St,gt,At)),B.appendChild($t)}function ne(Mt,mt,fe){var Ae="."+Mt+":"+mt,Ee=fe.cssText?Fe(fe):lr(fe);return document.createTextNode(Ae+"{"+Ee+"}");function Fe(ge){var De=ge.getPropertyValue("content");return ge.cssText+" content: "+De+";"}function lr(ge){return S.asArray(ge).map(De).join("; ")+";";function De(Pe){return Pe+": "+ge.getPropertyValue(Pe)+(ge.getPropertyPriority(Pe)?" !important":"")}}}}[":before",":after"].forEach((function(gt){lt(gt)}))}function Z(){b instanceof HTMLTextAreaElement&&(B.innerHTML=b.value),b instanceof HTMLInputElement&&B.setAttribute("value",b.value)}function rt(){B instanceof SVGElement&&(B.setAttribute("xmlns","http://www.w3.org/2000/svg"),B instanceof SVGRectElement&&["width","height"].forEach((function(lt){var gt=B.getAttribute(lt);gt&&B.style.setProperty(lt,gt)})))}})(H,F)})):Promise.resolve()}function dt(H){return h.resolveAll().then((function(Q){var D=document.createElement("style");return H.appendChild(D),D.appendChild(document.createTextNode(Q)),H}))}function _t(H){return U.inlineAll(H).then((function(){return H}))}O.exports=et})()},34:(O,_,S)=>{"use strict";S.r(_),S.d(_,{default:()=>gi});var $=/iPhone/i,h=/iPod/i,U=/iPad/i,it=/\biOS-universal(?:.+)Mac\b/i,et=/\bAndroid(?:.+)Mobile\b/i,bt=/Android/i,pt=/(?:SD4930UR|\bSilk(?:.+)Mobile\b)/i,ut=/Silk/i,dt=/Windows Phone/i,_t=/\bWindows(?:.+)ARM\b/i,H=/BlackBerry/i,Q=/BB10/i,D=/Opera Mini/i,F=/\b(CriOS|Chrome)(?:.+)Mobile/i,b=/Mobile(?:.+)Firefox\b/i,B=function(j){return j!==void 0&&j.platform==="MacIntel"&&typeof j.maxTouchPoints=="number"&&j.maxTouchPoints>1&&typeof MSStream>"u"};function z(j){var n={userAgent:"",platform:"",maxTouchPoints:0};j||typeof navigator>"u"?typeof j=="string"?n.userAgent=j:j&&j.userAgent&&(n={userAgent:j.userAgent,platform:j.platform,maxTouchPoints:j.maxTouchPoints||0}):n={userAgent:navigator.userAgent,platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints||0};var i=n.userAgent,c=i.split("[FBAN");c[1]!==void 0&&(i=c[0]),(c=i.split("Twitter"))[1]!==void 0&&(i=c[0]);var l=(function(C){return function(p){return p.test(C)}})(i),f={apple:{phone:l($)&&!l(dt),ipod:l(h),tablet:!l($)&&(l(U)||B(n))&&!l(dt),universal:l(it),device:(l($)||l(h)||l(U)||l(it)||B(n))&&!l(dt)},amazon:{phone:l(pt),tablet:!l(pt)&&l(ut),device:l(pt)||l(ut)},android:{phone:!l(dt)&&l(pt)||!l(dt)&&l(et),tablet:!l(dt)&&!l(pt)&&!l(et)&&(l(ut)||l(bt)),device:!l(dt)&&(l(pt)||l(ut)||l(et)||l(bt))||l(/\bokhttp\b/i)},windows:{phone:l(dt),tablet:l(_t),device:l(dt)||l(_t)},other:{blackberry:l(H),blackberry10:l(Q),opera:l(D),firefox:l(b),chrome:l(F),device:l(H)||l(Q)||l(D)||l(b)||l(F)},any:!1,phone:!1,tablet:!1};return f.any=f.apple.device||f.android.device||f.windows.device||f.other.device,f.phone=f.apple.phone||f.android.phone||f.windows.phone,f.tablet=f.apple.tablet||f.android.tablet||f.windows.tablet,f}var Y=S(379),Z=S.n(Y),rt=S(170),lt={insert:"head",singleton:!1};Z()(rt.Z,lt),rt.Z.locals;var gt=S(737),At={insert:"head",singleton:!1};Z()(gt.Z,At),gt.Z.locals;var Lt=S(223),St={insert:"head",singleton:!1};Z()(Lt.Z,St),Lt.Z.locals;function $t(){let j="ptro",n="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";for(let i=0;i<20;i+=1)j+=n.charAt(Math.floor(Math.random()*n.length));return j}function ne(j,n){let i=j.x-n.x,c=j.y-n.y;return Math.sqrt(i*i+c*c)}function Mt(j){return String(j).replace(/^\s+|\s+$/g,"")}let mt={y:89,z:90,s:83,c:67,x:88,a:65,l:76,p:80,r:82,o:79,b:66,e:69,t:84,f:70,enter:13,esc:27,del:46};function fe(j){console.warn(`[Painterro] ${j}`)}function Ae(j,n,i,c){n[i](j);let l=`[data-id="${c}"]`,f=document.querySelector(l);console.log(f,j),f?i==="setShadowOn"?f.setAttribute("data-value",j?"true":"false"):f.value=j:console.warn(`Control not found: ${l}`)}class Ee{constructor(n,i){this.main=n,this.canvas=n.canvas,this.wrapper=n.wrapper,this.ctx=n.ctx,this.areaionCallback=i,this.shown=!1,this.area={el:n.toolContainer,rect:document.querySelector(`#${n.id} .ptro-crp-rect`)},this.imagePlaced=!1,this.areaionCallback(!1)}static code(){return'<div class="ptro-crp-rect" hidden><div class="ptro-crp-l select-handler"></div><div class="ptro-crp-r select-handler"></div><div class="ptro-crp-t select-handler"></div><div class="ptro-crp-b select-handler"></div><div class="ptro-crp-tl select-handler"></div><div class="ptro-crp-tr select-handler"></div><div class="ptro-crp-bl select-handler"></div><div class="ptro-crp-br select-handler"></div></div>'}activate(){this.area.activated=!0,this.areaionCallback(!1)}doCrop(){let n=this.ctx.getImageData(0,0,this.main.size.w,this.main.size.h);this.main.resize(this.area.bottoml[0]-this.area.topl[0],this.area.bottoml[1]-this.area.topl[1]),this.main.ctx.putImageData(n,-this.area.topl[0],-this.area.topl[1]),this.main.adjustSizeFull(),this.main.worklog.captureState()}doPixelize(){let n=this.area.topl,i=[this.area.bottoml[0]-n[0],this.area.bottoml[1]-n[1]];if(this.pixelizePixelSize=this.main.params.pixelizePixelSize,this.pixelizePixelSize.slice(-1)==="%"?this.pixelSize=Math.min(i[0],i[1])/(100/this.pixelizePixelSize.slice(0,-1)):this.pixelizePixelSize.slice(-2).toLowerCase()==="px"?this.pixelSize=this.pixelizePixelSize.slice(0,-2):this.pixelSize=this.pixelizePixelSize,this.pixelSize<2&&(this.pixelSize=2),i[1]<i[0]){this.pixelSizeY=this.pixelSize;let C=Math.round(i[0]/this.pixelSizeY);this.pixelSizeX=1*i[0]/C}else{this.pixelSizeX=this.pixelSize;let C=Math.round(i[1]/this.pixelSizeX);this.pixelSizeY=1*i[1]/C}let c=[],l=[i[0]/this.pixelSizeX,i[1]/this.pixelSizeY];for(let C=0;C<l[0];C+=1){let p=[];for(let w=0;w<l[1];w+=1)p.push([0,0,0,0,0]);c.push(p)}let f=this.ctx.getImageData(n[0],n[1],i[0],i[1]);for(let C=0;C<i[0];C+=1)for(let p=0;p<i[1];p+=1){let w=Math.floor(C/this.pixelSizeX),W=Math.floor(p/this.pixelSizeY),ot=4*(p*i[0]+C);c[w][W][0]+=f.data[ot],c[w][W][1]+=f.data[ot+1],c[w][W][2]+=f.data[ot+2],c[w][W][3]+=f.data[ot+3],c[w][W][4]+=1}for(let C=0;C<l[0];C+=1)for(let p=0;p<l[1];p+=1){let w=c[C][p][4];this.ctx.fillStyle=`rgba(
${Math.round(c[C][p][0]/w)}, 
${Math.round(c[C][p][1]/w)}, 
${Math.round(c[C][p][2]/w)}, 
${Math.round(c[C][p][3]/w)})`;let W=n[0]+C*this.pixelSizeX,ot=n[1]+p*this.pixelSizeY;this.ctx.fillRect(W,ot,this.pixelSizeX,this.pixelSizeY)}this.main.worklog.captureState()}doClearArea(){this.ctx.beginPath(),this.ctx.clearRect(this.area.topl[0],this.area.topl[1],this.area.bottoml[0]-this.area.topl[0],this.area.bottoml[1]-this.area.topl[1]),this.ctx.rect(this.area.topl[0],this.area.topl[1],this.area.bottoml[0]-this.area.topl[0],this.area.bottoml[1]-this.area.topl[1]),this.ctx.fillStyle=this.main.currentBackground,this.ctx.fill(),this.main.worklog.captureState()}selectAll(){this.setLeft(0),this.setRight(0),this.setBottom(0),this.setTop(0),this.show(),this.reCalcCropperCords(),this.area.activated&&this.areaionCallback(!this.imagePlaced&&this.area.rect.clientWidth>0&&this.area.rect.clientHeight>0)}getScale(){return this.canvas.clientWidth/this.canvas.getAttribute("width")}reCalcCropperCords(){let n=this.getScale();this.area.topl=[Math.round((this.rectLeft()-this.main.elLeft())/n),Math.round((this.rectTop()-this.main.elTop())/n)],this.area.bottoml=[Math.round(this.area.topl[0]+(this.area.rect.clientWidth+2)/n),Math.round(this.area.topl[1]+(this.area.rect.clientHeight+2)/n)]}adjustPosition(){if(!this.shown)return;let n=this.getScale();this.setLeft(this.area.topl[0]*n),this.setTop(this.area.topl[1]*n),this.setRight(0),this.setRight(this.canvas.clientWidth-this.area.bottoml[0]*n),this.setBottom(this.canvas.clientHeight-this.area.bottoml[1]*n)}placeAt(n,i,c,l,f){this.imagePlaced&&this.finishPlacing(),this.main.closeActiveTool(!0),this.main.setActiveTool(this.main.defaultTool);let C=this.getScale();this.setLeft(n*C),this.setTop(i*C),this.setRight(c*C),this.setBottom(l*C);let p=document.createElement("canvas");p.width=f.naturalWidth,p.height=f.naturalHeight;let w=p.getContext("2d");w.drawImage(f,0,0),this.placedData=p.toDataURL("image/png");let W=1e3/Math.max(f.naturalWidth,f.naturalHeight);W>=1?this.placedDataLow=this.placedData:(p.width=f.naturalWidth*W,p.height=f.naturalHeight*W,w.scale(W,W),w.drawImage(f,0,0),this.placedDataLow=p.toDataURL("image/png")),this.main.select.area.rect.style["background-image"]=`url(${this.placedData})`,this.show(),this.reCalcCropperCords(),this.imagePlaced=!0,this.main.select.activate(),this.placedRatio=f.naturalWidth/f.naturalHeight}finishPlacing(){this.imagePlaced=!1,this.main.select.area.rect.style["background-image"]="none",this.main.inserter.insert(this.area.topl[0],this.area.topl[1],this.area.bottoml[0]-this.area.topl[0],this.area.bottoml[1]-this.area.topl[1]),this.area.activated=!1}cancelPlacing(){this.imagePlaced=!1,this.main.select.area.rect.style["background-image"]="none",this.hide(),this.main.worklog.undoState()}handleKeyDown(n){if(this.main.inserter.handleKeyDown(n))return!0;if(this.shown&&this.imagePlaced){if(n.keyCode===mt.enter)return this.finishPlacing(),!0;if(n.keyCode===mt.esc)return this.cancelPlacing(),!0}else{if(this.shown&&n.keyCode===mt.del)return this.doClearArea(),!0;if(n.keyCode===mt.a&&n.ctrlKey)return this.selectAll(),event.preventDefault(),!0;if(n.keyCode===mt.esc&&this.shown)return this.hide(),!0}return!1}handleMouseDown(n){let i=n.target.classList[0],c={"ptro-crp-el":()=>{if(this.area.activated){this.imagePlaced&&this.finishPlacing();let l=n.clientX-this.main.elLeft()+this.main.scroller.scrollLeft,f=n.clientY-this.main.elTop()+this.main.scroller.scrollTop;this.setLeft(l),this.setTop(f),this.setRight(this.area.el.clientWidth-l),this.setBottom(this.area.el.clientHeight-f),this.reCalcCropperCords(),this.area.resizingB=!0,this.area.resizingR=!0,this.hide()}},"ptro-crp-rect":()=>{this.area.moving=!0,this.area.xHandle=n.clientX-this.rectLeft()+this.main.scroller.scrollLeft,this.area.yHandle=n.clientY-this.rectTop()+this.main.scroller.scrollTop},"ptro-crp-tr":()=>{this.area.resizingT=!0,this.area.resizingR=!0},"ptro-crp-br":()=>{this.area.resizingB=!0,this.area.resizingR=!0},"ptro-crp-bl":()=>{this.area.resizingB=!0,this.area.resizingL=!0},"ptro-crp-tl":()=>{this.area.resizingT=!0,this.area.resizingL=!0},"ptro-crp-t":()=>{this.area.resizingT=!0},"ptro-crp-r":()=>{this.area.resizingR=!0},"ptro-crp-b":()=>{this.area.resizingB=!0},"ptro-crp-l":()=>{this.area.resizingL=!0}};i in c&&(c[i](),this.imagePlaced&&(this.main.select.area.rect.style["background-image"]=`url(${this.placedDataLow})`))}setLeft(n){this.left=n,this.area.rect.style.left=`${n}px`}setRight(n){this.right=n,this.area.rect.style.right=`${n}px`}setTop(n){this.top=n,this.area.rect.style.top=`${n}px`}setBottom(n){this.bottom=n,this.area.rect.style.bottom=`${n}px`}handleMouseMove(n){if(this.area.activated)if(this.area.moving){let i=n.clientX-this.main.elLeft()-this.area.xHandle+this.main.scroller.scrollLeft;i<0?i=0:i+this.area.rect.clientWidth>this.area.el.clientWidth-2&&(i=this.area.el.clientWidth-this.area.rect.clientWidth-2);let c=i-this.left;this.setLeft(i),this.setRight(this.right-c);let l=n.clientY-this.main.elTop()-this.area.yHandle+this.main.scroller.scrollTop;l<0?l=0:l+this.area.rect.clientHeight>this.area.el.clientHeight-2&&(l=this.area.el.clientHeight-this.area.rect.clientHeight-2);let f=l-this.top;this.setTop(l),this.setBottom(this.bottom-f),this.reCalcCropperCords()}else{let i=!1;if(this.area.resizingL){i=!0;let c=this.fixCropperLeft(n.clientX+this.main.scroller.scrollLeft);this.setLeft(c-this.main.elLeft()),this.reCalcCropperCords()}if(this.area.resizingR){i=!0;let c=this.fixCropperRight(n.clientX+this.main.scroller.scrollLeft);this.setRight(this.area.el.clientWidth+this.main.elLeft()-c),this.reCalcCropperCords()}if(this.area.resizingT){i=!0;let c=this.fixCropperTop(n.clientY+this.main.scroller.scrollTop);this.setTop(c-this.main.elTop()),this.reCalcCropperCords()}if(this.area.resizingB){i=!0;let c=this.fixCropperBottom(n.clientY+this.main.scroller.scrollTop);this.setBottom(this.area.el.clientHeight+this.main.elTop()-c),this.reCalcCropperCords()}!this.imagePlaced||n.ctrlKey||n.shiftKey||(this.area.resizingT&&(this.area.resizingL?this.leftKeepRatio():this.rightKeepRatio(),this.topKeepRatio(),this.reCalcCropperCords()),this.area.resizingB&&(this.area.resizingL?this.leftKeepRatio():this.rightKeepRatio(),this.bottomKeepRatio(),this.reCalcCropperCords()),this.area.resizingL&&(this.area.resizingT?this.topKeepRatio():this.bottomKeepRatio(),this.leftKeepRatio(),this.reCalcCropperCords()),this.area.resizingR&&(this.area.resizingT?this.topKeepRatio():this.bottomKeepRatio(),this.rightKeepRatio(),this.reCalcCropperCords())),i&&!this.shown&&this.show(),i&&(function(){let c=null;window.getSelection?c=window.getSelection():document.selection&&(c=document.selection),c&&(c.empty&&c.empty(),c.removeAllRanges&&c.removeAllRanges())})()}}leftKeepRatio(){let n=this.area.rect.clientHeight*this.placedRatio,i=this.main.elLeft()+(this.area.el.clientWidth-this.right-n-2),c=this.fixCropperLeft(i);this.setLeft(c-this.main.elLeft())}topKeepRatio(){let n=this.area.rect.clientWidth/this.placedRatio,i=this.fixCropperTop(this.main.elTop()+(this.area.el.clientHeight-this.bottom-n-2));this.setTop(i-this.main.elTop())}bottomKeepRatio(){let n=this.area.rect.clientWidth/this.placedRatio,i=this.fixCropperBottom(this.main.elTop()+this.top+n+2);this.setBottom(this.area.el.clientHeight+this.main.elTop()-i)}rightKeepRatio(){let n=this.area.rect.clientHeight*this.placedRatio,i=this.fixCropperRight(this.main.elLeft()+this.left+n+2);this.setRight(this.area.el.clientWidth+this.main.elLeft()-i)}show(){this.shown=!0,this.area.rect.removeAttribute("hidden")}handleMouseUp(){this.area.activated&&this.areaionCallback(!this.imagePlaced&&this.area.rect.clientWidth>0&&this.area.rect.clientHeight>0),this.area.moving=!1,this.area.resizingT=!1,this.area.resizingR=!1,this.area.resizingB=!1,this.area.resizingL=!1,this.imagePlaced&&(this.main.select.area.rect.style["background-image"]=`url(${this.placedData})`)}close(){this.imagePlaced&&this.finishPlacing(),this.area.activated=!1,this.hide()}hide(){this.area.rect.setAttribute("hidden","true"),this.shown=!1,this.areaionCallback(!1)}draw(){if(this.area.topl){let n=this.canvas.clientWidth/this.canvas.getAttribute("width");this.setLeft(this.area.topl[0]*n),this.setTop(this.area.topl[1]*n),this.setRight(this.area.el.clientWidth-(this.area.bottoml[0]-this.area.topl[0])*n),this.setBottom(this.area.el.clientHeight-(this.area.bottoml[1]-this.area.topl[1])*n)}}rectLeft(){return this.area.rect.documentOffsetLeft+this.main.scroller.scrollLeft}rectTop(){return this.area.rect.documentOffsetTop+this.main.scroller.scrollTop}fixCropperLeft(n){let i=n,c=this.rectLeft()+this.area.rect.clientWidth;return i<this.main.elLeft()?this.main.elLeft():(i>c&&(i=c,this.area.resizingL&&(this.area.resizingL=!1,this.area.resizingR=!0)),i)}fixCropperRight(n){let i=n,c=this.main.elLeft()+this.area.el.clientWidth;return i>c?c:(i<this.rectLeft()&&(i=this.rectLeft()+this.area.rect.clientWidth,this.area.resizingR&&(this.area.resizingR=!1,this.area.resizingL=!0)),i)}fixCropperTop(n){let i=n,c=this.rectTop()+this.area.rect.clientHeight;return i<this.main.elTop()?this.main.elTop():(i>c&&(i=c,this.area.resizingT&&(this.area.resizingT=!1,this.area.resizingB=!0)),i)}fixCropperBottom(n){let i=n,c=this.main.elTop()+this.area.el.clientHeight;return i>c?c:(i<this.rectTop()&&(i=this.rectTop()+this.area.rect.clientHeight,this.area.resizingB&&(this.area.resizingB=!1,this.area.resizingT=!0)),i)}}class Fe{constructor(n,i){this.main=n,this.current=null,this.changedHandler=i,this.empty=!0,this.clean=!0,this.ctx=n.ctx}getWorklogAsString(n){let i=Object.assign({},this.current),c=this.clearedCount;if(n.limit!==void 0){let l=n.limit;c=0;let f,C=i;for(f=0;f<l;f+=1)C.prevCount=l-f,f<l-1&&C.prev&&(C=C.prev);C.prev=null}return JSON.stringify({clearedCount:c,current:i})}loadWorklogFromString(n){let i=JSON.parse(n);return i&&(this.clearedCount=i.clearedCount,this.current=i.current,this.applyState(this.current)),this.main}changed(n){this.current.prevCount-this.clearedCount>this.main.params.worklogLimit&&(this.first=this.first.next,this.first.prev=null,this.clearedCount+=1),this.changedHandler({first:this.current.prev===null,last:this.current.next===null,initial:n}),this.empty=n,this.clean=!1}captureState(n){let i=this.main.activeTool?this.main.activeTool.name:null;this.main.params.NON_SELECTABLE_TOOLS.includes(i)&&(i=this.main.defaultTool.name);let c={sizew:this.main.size.w,sizeh:this.main.size.h,activeToolName:i,data:this.ctx.getImageData(0,0,this.main.size.w,this.main.size.h)};this.current===null?(c.prev=null,c.prevCount=0,this.first=c,this.clearedCount=0):(c.prev=this.current,c.prevCount=this.current.prevCount+1,this.current.next=c),c.next=null,this.current=c,this.changed(n)}reCaptureState(){this.current.prev!==null&&(this.current=this.current.prev),this.captureState()}applyState(n){this.main.resize(n.sizew,n.sizeh),this.main.ctx.putImageData(n.data,0,0),this.main.adjustSizeFull(),this.main.select.hide()}undoState(){if(this.current.prev!==null){let n=this.current.activeToolName;this.current=this.current.prev,this.applyState(this.current),this.changed(!1),n?(this.main.closeActiveTool(!0),this.main.setActiveTool(this.main.toolByName[n])):this.main.closeActiveTool(),this.main.params.onUndo&&this.main.params.onUndo(this.current)}}redoState(){if(this.current.next!==null){this.current=this.current.next,this.applyState(this.current),this.changed(!1);let n=this.current.activeToolName;n?(this.main.closeActiveTool(!0),this.main.setActiveTool(this.main.toolByName[n])):this.main.closeActiveTool(),this.main.params.onRedo&&this.main.params.onRedo(this.current)}}}class lr{constructor(n){this.ctx=n.ctx,this.el=n.toolContainer,this.main=n,this.helperCanvas=document.createElement("canvas"),this.canvas=n.canvas}activate(n){this.type=n,this.state={},this.ctx.lineJoin=n==="line"||n==="brush"||n==="eraser"||n==="arrow"?"round":"miter"}setLineWidth(n){if(!`${n}`.match(/^\d+$/))throw Error(`WARN: STR "${n}" is not an int`);this.lineWidth=+n}setShadowOn(n){this.shadowOn=n}setArrowLength(n){this.arrowLength=n}setEraserWidth(n){this.eraserWidth=n}handleMouseDown(n){this.activate(this.type);let i=n.target.classList[0];this.ctx.lineWidth=this.lineWidth,this.ctx.strokeStyle=this.main.colorWidgetState.line.alphaColor,this.ctx.fillStyle=this.main.colorWidgetState.fill.alphaColor;let c=this.main.getScale();if(this.ctx.lineCap="round",i==="ptro-crp-el"||i==="ptro-zoomer")if(this.tmpData=this.ctx.getImageData(0,0,this.main.size.w,this.main.size.h),this.type==="brush"||this.type==="eraser"){this.state.cornerMarked=!0;let l=[n.clientX-this.main.elLeft()+this.main.scroller.scrollLeft,n.clientY-this.main.elTop()+this.main.scroller.scrollTop],f={x:l[0]*c,y:l[1]*c};this.points=[f],this.drawBrushPath()}else this.state.cornerMarked=!0,this.centerCord=[n.clientX-this.main.elLeft()+this.main.scroller.scrollLeft,n.clientY-this.main.elTop()+this.main.scroller.scrollTop],this.centerCord=[this.centerCord[0]*c,this.centerCord[1]*c]}drawBrushPath(){let n=this.points,i,c=this.ctx.globalCompositeOperation,l=this.type==="eraser";i=this.main.colorWidgetState.line.alphaColor;let f=this.main.currentBackgroundAlpha!==1;for(let C=1;C<=(l&&f?2:1);C+=1)if(l&&(this.ctx.globalCompositeOperation=C===1&&f?"destination-out":c,i=C===1&&f?"rgba(0,0,0,1)":this.main.currentBackground),n.length===1)this.ctx.beginPath(),this.ctx.lineWidth=0,this.ctx.fillStyle=i,this.ctx.arc(this.points[0].x,this.points[0].y,this.lineWidth/2,this.lineWidth/2,0,2*Math.PI),this.ctx.fill(),this.ctx.closePath();else{let p;this.ctx.beginPath(),this.type==="eraser"?this.ctx.lineWidth=this.eraserWidth:this.ctx.lineWidth=this.lineWidth,this.ctx.strokeStyle=i,this.ctx.fillStyle=this.main.colorWidgetState.fill.alphaColor,this.ctx.moveTo(this.points[0].x,this.points[0].y),n.slice(1).forEach((w=>{this.ctx.lineTo(w.x,w.y),p=w})),p&&this.ctx.moveTo(p.x,p.y),this.ctx.stroke(),this.ctx.closePath()}this.ctx.globalCompositeOperation=c}handleMouseMove(n){let i=this.ctx;if(this.state.cornerMarked){this.ctx.putImageData(this.tmpData,0,0),this.curCord=[n.clientX-this.main.elLeft()+this.main.scroller.scrollLeft,n.clientY-this.main.elTop()+this.main.scroller.scrollTop];let c=this.main.getScale();if(this.curCord=[this.curCord[0]*c,this.curCord[1]*c],this.type==="brush"||this.type==="eraser"){let l={x:this.curCord[0],y:this.curCord[1]};this.points.push(l),this.drawBrushPath()}else if(this.type==="line"){if(n.ctrlKey||n.shiftKey){let f=180*Math.atan(-(this.curCord[1]-this.centerCord[1])/(this.curCord[0]-this.centerCord[0]))/Math.PI;if(Math.abs(f)<22.5)this.curCord[1]=this.centerCord[1];else if(Math.abs(f)>67.5)this.curCord[0]=this.centerCord[0];else{let C=(Math.abs(this.curCord[0]-this.centerCord[0])-Math.abs(this.centerCord[1]-this.curCord[1]))/2;this.curCord[0]-=C*(this.centerCord[0]<this.curCord[0]?1:-1),this.curCord[1]-=C*(this.centerCord[1]>this.curCord[1]?1:-1)}}i.beginPath(),i.moveTo(this.centerCord[0],this.centerCord[1]),i.lineTo(this.curCord[0],this.curCord[1]),i.closePath();let l=i.shadowColor;this.shadowOn&&(i.shadowColor="rgba(0,0,0,0.7)",i.shadowBlur=this.lineWidth,i.shadowOffsetX=this.lineWidth/2,i.shadowOffsetY=this.lineWidth/2),i.stroke(),i.shadowColor=l}else if(this.type==="arrow"){let l=180*Math.atan(-(this.curCord[1]-this.centerCord[1])/(this.curCord[0]-this.centerCord[0]))/Math.PI;if(n.ctrlKey||n.shiftKey)if(Math.abs(l)<22.5)this.curCord[1]=this.centerCord[1];else if(Math.abs(l)>67.5)this.curCord[0]=this.centerCord[0];else{let Or=(Math.abs(this.curCord[0]-this.centerCord[0])-Math.abs(this.centerCord[1]-this.curCord[1]))/2;this.curCord[0]-=Or*(this.centerCord[0]<this.curCord[0]?1:-1),this.curCord[1]-=Or*(this.centerCord[1]>this.curCord[1]?1:-1)}this.curCord[0]<this.centerCord[0]&&(l=180+l),this.ctx.beginPath();let f=this.ctx.lineCap,C=this.ctx.fillStyle;this.ctx.fillStyle=this.main.colorWidgetState.line.alphaColor,this.ctx.lineCap="square";let p=Math.min(this.arrowLength,.9*Math.sqrt((this.centerCord[0]-this.curCord[0])**2+(this.centerCord[1]-this.curCord[1])**2)),w=this.centerCord[0],W=this.centerCord[1],ot=this.curCord[0],zt=this.curCord[1],Bt=this.curCord[0],Ut=this.curCord[1],Tt,Vt,Yt;Tt=Math.atan2(zt-W,ot-w),Vt=p*Math.cos(Tt)+Bt,Yt=p*Math.sin(Tt)+Ut,this.ctx.moveTo(Vt,Yt),Tt+=.3333333333333333*(2*Math.PI),Vt=p*Math.cos(Tt)+Bt,Yt=p*Math.sin(Tt)+Ut,this.ctx.lineTo(Vt,Yt);let Ie=Bt+(Vt-Bt)/3,cr=Ut+(Yt-Ut)/3;i.lineTo(Ie,cr),i.lineTo(this.centerCord[0],this.centerCord[1]),Tt+=.3333333333333333*(2*Math.PI),Vt=p*Math.cos(Tt)+Bt,Yt=p*Math.sin(Tt)+Ut;let Rr=Bt+(Vt-Bt)/3,Nr=Ut+(Yt-Ut)/3;i.lineTo(Rr,Nr),i.lineTo(Vt,Yt),i.closePath();let Ve=i.shadowColor;this.shadowOn&&(i.shadowColor="rgba(0,0,0,0.7)",i.shadowBlur=Math.log(p)*this.main.params.shadowScale,i.shadowOffsetX=Math.log10(p),i.shadowOffsetY=Math.log10(p)),i.fill(),i.lineCap=f,i.fillStyle=C,i.shadowColor=Ve}else if(this.type==="rect"){i.beginPath();let l=[this.centerCord[0],this.centerCord[1]],f=this.curCord[0]-this.centerCord[0],C=this.curCord[1]-this.centerCord[1];if(n.ctrlKey||n.shiftKey){let W=Math.min(Math.abs(f),Math.abs(C));f=W*Math.sign(f),C=W*Math.sign(C)}let p=this.lineWidth/2;f<0&&(l[0]+=f,f=-f),C<0&&(l[1]+=C,C=-C),this.ctx.rect(l[0]+p,l[1]+p,f-this.lineWidth,C-this.lineWidth),this.ctx.fill();let w=i.shadowColor;this.shadowOn&&(i.shadowColor="rgba(0,0,0,0.7)",i.shadowBlur=this.lineWidth,i.shadowOffsetX=this.lineWidth/2,i.shadowOffsetY=this.lineWidth/2),this.lineWidth&&this.ctx.strokeRect(l[0],l[1],f,C),i.shadowColor=w,this.ctx.closePath()}else if(this.type==="ellipse"){this.ctx.beginPath();let l=this.centerCord[0],f=this.centerCord[1],C=this.curCord[0]-l,p=this.curCord[1]-f;if(n.ctrlKey||n.shiftKey){let cr=Math.min(Math.abs(C),Math.abs(p));C=cr*Math.sign(C),p=cr*Math.sign(p)}let w=Math.abs(C),W=Math.abs(p),ot=Math.min(l,l+C),zt=Math.min(f,f+p);this.ctx.save();let Bt,Ut=1,Tt=1,Vt=w/2,Yt=W/2;w>W?(Tt=w/W,Bt=Vt):(Ut=W/w,Bt=Yt),this.ctx.scale(1/Ut,1/Tt),this.ctx.arc((ot+Vt)*Ut,(zt+Yt)*Tt,Bt,0,2*Math.PI),this.ctx.restore(),this.ctx.fill();let Ie=i.shadowColor;this.shadowOn&&(i.shadowColor="rgba(0,0,0,0.7)",i.shadowBlur=this.lineWidth,i.shadowOffsetX=this.lineWidth/2,i.shadowOffsetY=this.lineWidth/2),i.stroke(),i.shadowColor=Ie,this.ctx.beginPath()}}}handleMouseUp(){this.state.cornerMarked&&(this.state.cornerMarked=!1,this.main.worklog.captureState())}setPixelSize(n){this.pixelSize=n}}let ge={lineColor:"L",lineColorFull:"Linienfarbe",fillColor:"F",fillColorFull:"F\xFCllfarbe",alpha:"A",alphaFull:"Alpha",lineWidth:"B",lineWidthFull:"Linienbreite",arrowLength:"L",arrowLengthFull:"Pfeill\xE4nge",eraserWidth:"E",eraserWidthFull:"Radiergummibreite",textColor:"C",textColorFull:"Textfarbe",fontSize:"S",fontSizeFull:"Schriftgr\xF6\xDFe",fontStrokeSize:"St",fontStrokeSizeFull:"Strichbreite",fontStyle:"FS",fontStyleFull:"Schriftstil",fontName:"F",fontNameFull:"Schriftartenname",textStrokeColor:"SC",textStrokeColorFull:"Strichfarbe",apply:"Anwenden",cancel:"Abbrechen",close:"Schlie\xDFen",clear:"Zur\xFCcksetzen",width:"Breite",height:"H\xF6he",keepRatio:"Breiten- / H\xF6henverh\xE4ltnis beibehalten",fillPageWith:"F\xFCllen Sie die Seite mit der aktuellen Hintergrundfarbe",pixelSize:"P",pixelSizeFull:"Pixel Gr\xF6\xDFe",resizeScale:"Ma\xDFstab",resizeResize:"Gr\xF6\xDFe \xE4ndern",backgroundColor:"Hintergrundfarbe der Seite",pixelizePixelSize:"Pixelate Pixelgr\xF6\xDFe",language:"Sprache",wrongPixelSizeValue:"Falsche Pixelgr\xF6\xDFe. Sie k\xF6nnen zum Beispiel '20%' eingeben. Welche mittlere Pixelgr\xF6\xDFe wird 1/5 von die ausgew\xE4hlte Bereichsseite, oder '4' bedeutet 4 px",tools:{crop:"Bild auf ausgew\xE4hlten Bereich zuschneiden",pixelize:"Pixelisierung des ausgew\xE4hlten Bereiches",rect:"Rechteck zeichnen",ellipse:"Ellipse zeichnen",line:"Linie zeichnen",arrow:"Pfeil zeichnen",rotate:"Bild umdrehen",save:"Bild speichern",load:"Bild hochladen",text:"Text hinzuf\xFCgen",brush:"Pinsel",resize:"Gr\xF6\xDFe \xE4ndern oder skalieren",open:"Bild \xF6ffnen",select:"Bereich ausw\xE4hlen",close:" Painterro schlie\xDFen",eraser:"Radierer",settings:"Einstellungen",undo:"R\xFCckg\xE4ngig machen",redo:"Wiederholen"},pasteOptions:{fit:"Alle Austauschen ",extend_down:"Nach unten strecken",extend_right:"Nach rechts strecken",extend:"Strecken",over:"\xDCberkleben",how_to_paste:"Wie f\xFCge ich hinzu?"}},De={lineColor:"L",lineColorFull:"Line color",fillColor:"F",fillColorFull:"Fill color",alpha:"A",alphaFull:"Alpha",lineWidth:"W",lineWidthFull:"Line width",arrowLength:"L",arrowLengthFull:"Arrow length",eraserWidth:"E",eraserWidthFull:"Eraser width",textColor:"C",textColorFull:"Text color",fontSize:"S",fontSizeFull:"Font size",fontStrokeSize:"St",fontStrokeSizeFull:"Stroke width",fontIsBold:"<b>B</b>",fontIsBoldFull:"Bold",fontIsItalic:"<i>I</i>",fontIsItalicFull:"Italic",shadowOn:"SH",shadowOnFull:"Shadow",fontStrokeAndShadow:"S&S",fontStrokeAndShadowFull:"Stroke & Shadow",fontName:"F",fontNameFull:"Font name",textStrokeColor:"SC",textStrokeColorFull:"Stroke color",apply:"Apply",cancel:"Cancel",close:"Close",clear:"Clear",width:"Width",height:"Height",keepRatio:"Keep width/height ratio",fillPageWith:"Fill page with current background color",pixelSize:"P",pixelSizeFull:"Pixel size",resizeScale:"Scale",resizeResize:"Resize",backgroundColor:"Page background color",pixelizePixelSize:"Pixelize pixel size",language:"Language",wrongPixelSizeValue:"Wrong pixel size. You can enter e.g. '20%' which mean pixel size will be 1/5 of the selected area side, or '4' means 4 px",tools:{crop:"Crop image to selected area",pixelize:"Pixelize selected area",rect:"Draw rectangle",ellipse:"Draw ellipse",line:"Draw line",arrow:"Draw arrow",rotate:"Rotate image",save:"Save image",load:"Load image",text:"Put text",brush:"Brush",resize:"Resize or scale",open:"Open image",select:"Select area",close:"Close Painterro",eraser:"Eraser",settings:"Settings",zoomin:"Zoom In",zoomout:"Zoom Out",undo:"Undo",redo:"Redo",clear:"Clear",bucket:"Fill"},pasteOptions:{fit:"Replace all",extend_down:"Extend down",extend_right:"Extend right",extend_left:"Extend left",extend_top:"Extend top",extend:"Add",over:"Paste over",how_to_paste:"How to paste?"}},Pe={lineColor:"L",lineColorFull:"Color de linea",fillColor:"O",fillColorFull:"Color de relleno",alpha:"T",alphaFull:"Transparencia",lineWidth:"A",lineWidthFull:"Ancho de linea",eraserWidth:"B",eraserWidthFull:"Ancho de borrador",textColor:"C",textColorFull:"Color de texto",fontSize:"L",fontSizeFull:"Tama\xF1o de letra",fontStrokeSize:"TLl",fontStrokeSizeFull:"Tama\xF1o de linea de letra",fontStyle:"EL",fontStyleFull:"Estilo de letra",fontName:"NL",fontNameFull:"Nombre del tipo de letra",textStrokeColor:"CL",textStrokeColorFull:"Color de letra",apply:"Aplicar",cancel:"Cancelar",close:"Cerrar",clear:"Limpiar",width:"Ancho",height:"Alto",keepRatio:"Mantener ratio Ancho/Alto",fillPageWith:"Rellenar la p\xE1gina con el color de fondo actual",pixelSize:"P",pixelSizeFull:"Tama\xF1o de pixel",resizeScale:"Escala",resizeResize:"Redimensionar",backgroundColor:"Color de fondo de la p\xE1gina",pixelizePixelSize:"Tama\xF1o de pixel al pixelar",wrongPixelSizeValue:"Tama\xF1o de pixel incorrecto. Puedes entrar por ejemplo '20%' que significa que el tama\xF1o de pixel es 1/5 del area seleccionada, o '4' significa 4 px",tools:{crop:"Recortar imagen a la area seleccionada",pixelize:"Pixelar la area seleccionada",rect:"Dibujar rect\xE1ngulo",ellipse:"Dibujar eclipse",line:"Dibujar linea",rotate:"Rotar imagen",save:"Guardar imagen",load:"Cargar imagen",text:"Escribir texto",brush:"Pincel",resize:"Cambiar tama\xF1o o escalar",open:"Abrir imagen",select:"Selecci\xF3n de area",close:"Cerrar editor",eraser:"Borrador",settings:"Par\xE1metros"},pasteOptions:{fit:"Reemplazar todo",extend_down:"Extender hacia abajo",extend_right:"Extender a la derecha",extend:"Extender",over:"Pegar encima",how_to_paste:"C\xF3mo se ha de pegar?"}},Dr={lineColor:"L",lineColorFull:"Color de l\xEDnia",fillColor:"O",fillColorFull:"Color per omplir",alpha:"T",alphaFull:"Transpar\xE8ncia",lineWidth:"A",lineWidthFull:"Ample de l\xEDnia",arrowLength:"L",arrowLengthFull:"Longitud de la fletxa",eraserWidth:"B",eraserWidthFull:"Ample de borrador",textColor:"C",textColorFull:"Color de texte",fontSize:"L",fontSizeFull:"Tamany de la lletra",fontStrokeSize:"TLl",fontStrokeSizeFull:"Tamany linea de la lletra",fontStyle:"EL",fontStyleFull:"Estil de lletra",fontName:"NL",fontNameFull:"Nom del tipus de lletra",textStrokeColor:"CL",textStrokeColorFull:"Color de lletra",apply:"Aplicar",cancel:"Cancel\xB7lar",close:"Tancar",clear:"Netejar",width:"Ample",height:"Alt",keepRatio:"Mantenir ratio Ample/Alt",fillPageWith:"Omplir la p\xE0gina amb el color de fons actual",pixelSize:"P",pixelSizeFull:"Tamany de pixel",resizeScale:"Escala",resizeResize:"Redimensionar",backgroundColor:"Color de fons de la p\xE0gina",pixelizePixelSize:"Tamany de p\xEDxel al pixelar",wrongPixelSizeValue:"Tamany de p\xEDxel incorrecte. Pots entrar per exemple '20%' que significa que el tamany de p\xEDxel \xE9s 1/5 de l'\xE0rea seleccionada, o '4' significa 4 px",tools:{crop:"Retallar imatge a l'\xE0rea seleccionada",pixelize:"Pixelar l'\xE0rea seleccionada",rect:"Dibuixar rectangle",ellipse:"Dibuixar eclipse",line:"Dibuixar l\xEDnia",arrow:"Dibuixa la fletxa",rotate:"Rotar imatge",save:"Guardar image",load:"Carregar image",text:"Escriure texte",brush:"Pinzell",resize:"Cambiar tamany o escalar",open:"Obrir imatge",select:"Seleci\xF3 d'\xE0rea",close:"Tancar editor",eraser:"Borrador",settings:"Par\xE0metres",undo:"Desfer",filters:"Filtres"},pasteOptions:{fit:"Reempla\xE7ar tot",extend_down:"Extendre cap avall",extend_right:"Extendre a la dreta",extend:"Extendre",over:"Empegar al damunt",how_to_paste:"Com s'ha d'empegar?"}},Pr={lineColor:"CL",lineColorFull:"Couleur de la ligne",fillColor:"CR",fillColorFull:"Couleur de Remplissage",alpha:"T",alphaFull:"Transparence",lineWidth:"L",lineWidthFull:"Largeur de ligne",arrowLength:"F",arrowLengthFull:"Longeur de la fl\xE8che",eraserWidth:"LG",eraserWidthFull:"Largeur de la gomme",textColor:"CT",textColorFull:"Couleur du texte",fontSize:"TP",fontSizeFull:"Taille de Police",fontStrokeSize:"LT",fontStrokeSizeFull:"Largeur du trait",fontStyle:"SP",fontStyleFull:"Style de police",fontName:"NP",fontNameFull:"Nom de la police",textStrokeColor:"CT",textStrokeColorFull:"Couleur du trait",apply:"Appliquer",cancel:"Annuler",close:"Fermer",clear:"Effacer",width:"Largeur",height:"Hauteur",keepRatio:"Conserver le rapport largeur/hauteur",fillPageWith:"Remplir avec la couleur d'arri\xE8re-plan courante",pixelSize:"P",pixelSizeFull:"Taille de Pixel",resizeScale:"\xC9chelle",resizeResize:"Redimensionner",backgroundColor:"Couleur de fond de la page",pixelizePixelSize:"Pix\xE9liser la taille de pixel",language:"Langue",wrongPixelSizeValue:"Mauvaise taille de pixel. Vous pouvez ajouter par exemple e.g. '20%' ce qui signifie que la taille moyenne des pixels sera 1/5 de la surface s\xE9lectionn\xE9e, ou '4' signifie 4 px",tools:{crop:"Recadrer l'image dans la zone s\xE9lectionn\xE9e",pixelize:"Pix\xE9liser la zone s\xE9lectionn\xE9e",rect:"Dessiner un rectangle",ellipse:"Dessiner une ellipse",line:"Dessiner une ligne",arrow:"Dessiner une fl\xE8che",rotate:"Pivoter l'image",save:"Enregistrer l'image",load:"Charger l'image",text:"Mettre du texte",brush:"Brosse",resize:"Redimensionner ou \xE9chelle",open:"Ouvrir l'image",select:"S\xE9lectionnez une r\xE9gion",close:"Fermer Painterro",eraser:"Gomme",settings:"R\xE9glages",undo:"Annuler",redo:"Refaire"},pasteOptions:{fit:"Tout Remplacer",extend_down:"\xC9tendre vers le bas",extend_right:"\xC9tendre \xE0 droite",extend:"\xC9tendre",over:"Coller sur",how_to_paste:"Comment coller?"}},_r={lineColor:"K",lineColorFull:"Kolor linii",fillColor:"W",fillColorFull:"Kolor wype\u0142nienia",alpha:"A",alphaFull:"Alpha",lineWidth:"L",lineWidthFull:"Szeroko\u015B\u0107 linii",arrowLength:"S",arrowLengthFull:"Rozmiar strza\u0142ki",eraserWidth:"G",eraserWidthFull:"Wielko\u015B\u0107 gumki",textColor:"K",textColorFull:"Kolor tekstu",fontSize:"R",fontSizeFull:"Rozmiar czcionki",fontStrokeSize:"Sk",fontStrokeSizeFull:"Szeroko\u015B\u0107 kreski",fontStyle:"Sc",fontStyleFull:"Styl czcionki",fontName:"C",fontNameFull:"Czcionka",textStrokeColor:"Kk",textStrokeColorFull:"Kolor kreski",apply:"Zastosuj",cancel:"Anuluj",close:"Zamknij",clear:"Wyczy\u015B\u0107",width:"Szeroko\u015B\u0107",height:"Wysoko\u015B\u0107",keepRatio:"Zachowaj wsp\xF3\u0142czynnik proporcji",fillPageWith:"Wype\u0142nij stron\u0119 obecnym kolorem t\u0142a",pixelSize:"P",pixelSizeFull:"Rozmiar pixela",resizeScale:"Skala",resizeResize:"Zmie\u0144 rozmiar",backgroundColor:"Kolor t\u0142a strony",pixelizePixelSize:"Rozmiar pixela Pixelizera",language:"J\u0119zyk",wrongPixelSizeValue:"Z\u0142y rozmiar pixela. Poprawne warto\u015Bci to np. '20%', co oznacza przyj\u0119cie rozmiaru pixela jako 20% pola wybranego obszaru, lub '4' jako 4 px",tools:{crop:"Przytnij obraz do wybranego obszaru",pixelize:"Pixelizuj wybrany obszar",rect:"Rysuj prostok\u0105t",ellipse:"Rysuj elipse",line:"Rysuj lini\u0119",arrow:"Rysuj strza\u0142k\u0119",rotate:"Obr\xF3\u0107 obraz",save:"Zapisz obraz",load:"Wczytaj obraz",text:"Dodaj tekst",brush:"P\u0119dzel",resize:"Zmie\u0144 rozmiar lub skal\u0119",open:"Otw\xF3rz obraz",select:"Wybierz obszar",close:"Zamknij Painterro",eraser:"Gumka",settings:"Ustawienia",undo:"Cofnij",redo:"Przywr\xF3\u0107"},pasteOptions:{fit:"Zast\u0105p",extend_down:"Dodaj poni\u017Cej",extend_right:"Dodaj po prawej",extend:"Dodaj",over:"Dodaj ponad",how_to_paste:"Jak wklei\u0107?"}},Yr={lineColor:"L",lineColorFull:"Cor da linha",fillColor:"O",fillColorFull:"Cor do preenchimento",alpha:"T",alphaFull:"Transpar\xEAncia",lineWidth:"A",lineWidthFull:"Largura de linha",eraserWidth:"B",eraserWidthFull:"Largura do apagador",textColor:"C",textColorFull:"Cor do texto",fontSize:"L",fontSizeFull:"Tamanho da letra",fontStrokeSize:"TLl",fontStrokeSizeFull:"Tamanho da linha da letra",fontStyle:"EL",fontStyleFull:"Tipo de letra",fontName:"NL",fontNameFull:"Nome do tipo de letra",textStrokeColor:"CL",textStrokeColorFull:"Cor da letra",apply:"Aplicar",cancel:"Cancelar",close:"Fechar",clear:"Limpar",width:"Largura",height:"Altura",keepRatio:"Manter r\xE1cio Largura/Altura",fillPageWith:"Preencher a p\xE1gina com a cor de fundo actual",pixelSize:"P",pixelSizeFull:"Tamanho de p\xEDxel",resizeScale:"Escala",resizeResize:"Redimensionar",backgroundColor:"Cor de fundo da p\xE1gina",pixelizePixelSize:"Tamanho de p\xEDxel ao Pixelizar",wrongPixelSizeValue:"Tamanho de p\xEDxel incorrecto. Podes colocar por exemplo '20%' que significa que o tamanho de p\xEDxel \xE9 1/5 da \xE1rea seleccionada, o '4' significa 4 px",tools:{crop:"Recortar imagem pela \xE1rea seleccionada",pixelize:"Pixelizar a \xE1rea seleccionada",rect:"Desenhar rect\xE2ngulo",ellipse:"Desenhar elipse",line:"Desenhar linha",rotate:"Rodar imagem",save:"Guardar imagem",load:"Carregar imagem",text:"Escrever texto",brush:"Pincel",resize:"Alterar tamanho ao redimensionar",open:"Abrir imagem",select:"Selec\xE7\xE3o da \xE1rea",close:"Fechar editor",eraser:"Apagador",settings:"Defini\xE7\xF5es"},pasteOptions:{fit:"Substituir tudo",extend_down:"Acrescentar por baixo",extend_right:"Acrescentar pela direita",extend:"Acrescentar",over:"Por cima",how_to_paste:"Como colar?"}},jr={lineColor:"L",lineColorFull:"Cor da linha",fillColor:"O",fillColorFull:"Cor do preenchimento",alpha:"T",alphaFull:"Transpar\xEAncia",lineWidth:"A",lineWidthFull:"Largura de linha",eraserWidth:"B",eraserWidthFull:"Largura do apagador",textColor:"C",textColorFull:"Cor do texto",fontSize:"L",fontSizeFull:"Tamanho da letra",fontStrokeSize:"TLl",fontStrokeSizeFull:"Tamanho da linha da letra",fontStyle:"EL",fontStyleFull:"Estilo de letra",fontName:"NL",fontNameFull:"Nome do tipo de letra",textStrokeColor:"CL",textStrokeColorFull:"Cor da letra",apply:"Aplicar",cancel:"Cancelar",close:"Fechar",clear:"Limpar",width:"Largura",height:"Altura",keepRatio:"Manter r\xE1cio Largura/Altura",fillPageWith:"Preencher a p\xE1gina com a cor de fundo atual",pixelSize:"P",pixelSizeFull:"Tamanho de p\xEDxel",resizeScale:"Escala",resizeResize:"Redimensionar",backgroundColor:"Cor de fundo da p\xE1gina",pixelizePixelSize:"Tamanho de p\xEDxel ao Pixelizar",wrongPixelSizeValue:"Tamanho de p\xEDxel incorreto. Pode colocar por exemplo '20%' que significa que o tamanho de p\xEDxel \xE9 1/5 da \xE1rea selecionada, o '4' significa 4 px",tools:{crop:"Recortar imagem pela \xE1rea selecionada",pixelize:"Pixelizar a \xE1rea selecionada",rect:"Desenhar ret\xE2ngulo",ellipse:"Desenhar elipse",line:"Desenhar linha",rotate:"Girar imagem",save:"Salvar imagem",load:"Carregar imagem",text:"Escrever texto",brush:"Pincel",resize:"Alterar tamanho ao redimensionar",open:"Abrir imagem",select:"Sele\xE7\xE3o da \xE1rea",close:"Fechar editor",eraser:"Apagador",settings:"Configura\xE7\xF5es"},pasteOptions:{fit:"Substituir tudo",extend_down:"Acrescentar por baixo",extend_right:"Acrescentar pela direita",extend:"Acrescentar",over:"Por cima",how_to_paste:"Como colar?"}},si={lineColor:"\u041B",lineColorFull:"\u0426\u0432\u0435\u0442 \u043B\u0438\u043D\u0438\u0438",fillColor:"\u0417",fillColorFull:"\u0426\u0432\u0435\u0442 \u0437\u0430\u043B\u0438\u0432\u043A\u0438",alpha:"\u041F",alphaFull:"\u041F\u0440\u043E\u0437\u0440\u0430\u0447\u043D\u043E\u0441\u0442\u044C",lineWidth:"\u0428",lineWidthFull:"\u0428\u0438\u0440\u0438\u043D\u0430 \u043B\u0438\u043D\u0438\u0438",arrowLength:"\u0428",arrowLengthFull:"\u0428\u0438\u0440\u0438\u043D\u0430 \u0441\u0442\u0440\u0435\u043B\u043A\u0438",eraserWidth:"\u0428",eraserWidthFull:"\u0428\u0438\u0440\u0438\u043D\u0430 \u043B\u0430\u0441\u0442\u0438\u043A\u0430",textColor:"\u0426",textColorFull:"\u0426\u0432\u0435\u0442 \u0442\u0435\u043A\u0441\u0442\u0430",fontSize:"\u0420",fontSizeFull:"\u0420\u0430\u0437\u043C\u0435\u0440 \u0448\u0440\u0438\u0444\u0442\u0430",fontStrokeSize:"\u0428",fontStrokeSizeFull:"\u0428\u0438\u0440\u0438\u043D\u0430 \u0448\u0442\u0440\u0438\u0445\u0430",fontIsBold:"<b>\u0416</b>",fontIsBoldFull:"\u0416\u0438\u0440\u043D\u044B\u0439",fontIsItalic:"<i>\u041A</i>",fontIsItalicFull:"\u041A\u0443\u0440\u0441\u0438\u0432",shadowOn:"\u0422",shadowOnFull:"\u0422\u0435\u043D\u044C",fontStrokeAndShadow:"\u041E&\u0422",fontStrokeAndShadowFull:"\u041E\u0431\u0432\u043E\u0434\u043A\u0430 \u0438 \u0422\u0435\u043D\u044C",fontName:"\u0428",fontNameFull:"\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0448\u0440\u0438\u0444\u0442\u0430",textStrokeColor:"\u0426\u041E",textStrokeColorFull:"\u0426\u0432\u0435\u0442 \u043E\u0431\u0432\u043E\u0434\u043A\u0438",apply:"\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C",cancel:"\u041E\u0442\u043C\u0435\u043D\u0430",close:"\u0417\u0430\u043A\u0440\u044B\u0442\u044C",clear:"\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C",width:"\u0428\u0438\u0440\u0438\u043D\u0430",height:"\u0412\u044B\u0441\u043E\u0442\u0430",keepRatio:"\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0441\u043E\u043E\u0442\u043D\u043E\u0448\u0435\u043D\u0438\u0435 \u0448\u0438\u0440\u0438\u043D\u044B/\u0432\u044B\u0441\u043E\u0442\u044B",fillPageWith:"\u0417\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0442\u0435\u043A\u0443\u0449\u0438\u043C \u0446\u0432\u0435\u0442\u043E\u043C \u0444\u043E\u043D\u0430",pixelSize:"\u041F",pixelSizeFull:"\u0420\u0430\u0437\u043C\u0435\u0440 \u043F\u0438\u043A\u0441\u0435\u043B\u044F",resizeScale:"\u041C\u0430\u0441\u0448\u0442\u0430\u0431",resizeResize:"\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0440\u0430\u0437\u043C\u0435\u0440",backgroundColor:"\u0426\u0432\u0435\u0442 \u0444\u043E\u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B",pixelizePixelSize:"\u041F\u0438\u043A\u0441\u0435\u043B\u0438\u0437\u0430\u0446\u0438\u044F \u0440\u0430\u0437\u043C\u0435\u0440\u0430 \u043F\u0438\u043A\u0441\u0435\u043B\u044F",language:"\u042F\u0437\u044B\u043A",wrongPixelSizeValue:"\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u044B\u0439 \u0440\u0430\u0437\u043C\u0435\u0440 \u043F\u0438\u043A\u0441\u0435\u043B\u044F. \u0412\u044B \u043C\u043E\u0436\u0435\u0442\u0435 \u0432\u0432\u0435\u0441\u0442\u0438, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 '20%', \u0447\u0442\u043E \u043E\u0437\u043D\u0430\u0447\u0430\u0435\u0442, \u0447\u0442\u043E \u0441\u0440\u0435\u0434\u043D\u0438\u0439 \u0440\u0430\u0437\u043C\u0435\u0440 \u043F\u0438\u043A\u0441\u0435\u043B\u044F \u0431\u0443\u0434\u0435\u0442 1/5 \u043E\u0442\u0441\u0442\u043E\u0440\u043E\u043D\u044B \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0439 \u043E\u0431\u043B\u0430\u0441\u0442\u0438 \u0438\u043B\u0438 '4', \u0447\u0442\u043E \u043E\u0437\u043D\u0430\u0447\u0430\u0435\u0442 4 \u043F\u0438\u043A\u0441\u0435\u043B\u044F",tools:{crop:"\u041E\u0431\u0440\u0435\u0437\u0430\u0442\u044C \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 \u0434\u043E \u0432\u044B\u0434\u0435\u043B\u0435\u043D\u043D\u043E\u0439 \u043E\u0431\u043B\u0430\u0441\u0442\u0438",pixelize:"\u0421\u0434\u0435\u043B\u0430\u0442\u044C \u043F\u0438\u043A\u0441\u0435\u043B\u0438\u0437\u0430\u0446\u0438\u044E \u0432\u044B\u0434\u0435\u043B\u0435\u043D\u043D\u043E\u0439 \u043E\u0431\u043B\u0430\u0441\u0442\u0438",rect:"\u0420\u0438\u0441\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u044F\u043C\u043E\u0443\u0433\u043E\u043B\u044C\u043D\u0438\u043A",ellipse:"\u0420\u0438\u0441\u043E\u0432\u0430\u0442\u044C \u044D\u043B\u043B\u0438\u043F\u0441",line:"\u0420\u0438\u0441\u043E\u0432\u0430\u0442\u044C \u043B\u0438\u043D\u0438\u044E",arrow:"\u0420\u0438\u0441\u043E\u0432\u0430\u0442\u044C \u0421\u0442\u0440\u0435\u043B\u043A\u0443",rotate:"\u041F\u043E\u0432\u0435\u0440\u043D\u0443\u0442\u044C \u043B\u0438\u0441\u0442",save:"\u0421\u043E\u0445\u0440\u043D\u0438\u0442\u044C \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435",load:"\u0417\u0430\u0433\u0440\u0443\u0437\u0442\u044C \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435",text:"\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0442\u0435\u043A\u0441\u0442",brush:"\u041A\u0438\u0441\u0442\u044C",resize:"\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0440\u0430\u0437\u043C\u0435\u0440 \u0438\u043B\u0438 \u043C\u0430\u0441\u0448\u0442\u0430\u0431",open:"\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435",select:"\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u043E\u0431\u043B\u0430\u0441\u0442\u044C",close:"\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u0440\u0435\u0434\u0430\u043A\u0442\u043E\u0440",eraser:"\u041B\u0430\u0441\u0442\u0438\u043A",settings:"\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",undo:"\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C",redo:"\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C"},pasteOptions:{fit:"\u0417\u0430\u043C\u0435\u043D\u0438\u0442\u044C \u0432\u0441\u0451",extend_down:"\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u043D\u0438\u0437",extend_right:"\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u043F\u0440\u0430\u0432\u043E",extend_left:"\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u043B\u0435\u0432\u043E",extend_top:"\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u0432\u0435\u0440\u0445",extend:"\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C",over:"\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044C",how_to_paste:"\u041A\u0430\u043A \u0432\u0441\u0442\u0430\u0432\u0438\u0442\u044C?"}},Ai={lineColor:"\u7DDA",lineColorFull:"\u7DDA\u306E\u8272",fillColor:"\u5857",fillColorFull:"\u5857\u308A\u3064\u3076\u3057\u306E\u8272",alpha:"A",alphaFull:"\u30A2\u30EB\u30D5\u30A1",lineWidth:"\u5E45",lineWidthFull:"\u7DDA\u306E\u5E45",arrowLength:"\u77E2",arrowLengthFull:"\u77E2\u5370\u306E\u9577\u3055",eraserWidth:"\u5E45",eraserWidthFull:"\u6D88\u3057\u30B4\u30E0\u306E\u5E45",textColor:"\u8272",textColorFull:"\u30C6\u30AD\u30B9\u30C8\u306E\u8272",fontSize:"\u7D1A",fontSizeFull:"\u30D5\u30A9\u30F3\u30C8\u30B5\u30A4\u30BA",fontStrokeSize:"\u5E45",fontStrokeSizeFull:"\u30B9\u30C8\u30ED\u30FC\u30AF\u306E\u5E45",fontStyle:"\u66F8\u5F0F",fontStyleFull:"\u30D5\u30A9\u30F3\u30C8\u30B9\u30BF\u30A4\u30EB",fontName:"\u66F8\u4F53",fontNameFull:"\u30D5\u30A9\u30F3\u30C8",textStrokeColor:"SC",textStrokeColorFull:"\u30B9\u30C8\u30ED\u30FC\u30AF\u306E\u8272",apply:"\u9069\u7528",cancel:"\u30AD\u30E3\u30F3\u30BB\u30EB",close:"\u9589\u3058\u308B",clear:"\u30AF\u30EA\u30A2",width:"\u5E45",height:"\u9AD8\u3055",keepRatio:"\u5E45\uFF0F\u9AD8\u3055\u306E\u30A2\u30B9\u30DA\u30AF\u30C8\u6BD4\u3092\u4FDD\u3064",fillPageWith:"\u80CC\u666F\u8272\u3067\u30DA\u30FC\u30B8\u3092\u5857\u308A\u3064\u3076\u3059",pixelSize:"\u30E2\u30B6",pixelSizeFull:"\u30E2\u30B6\u30A4\u30AF\u30B5\u30A4\u30BA",resizeScale:"\u30B9\u30B1\u30FC\u30EB",resizeResize:"\u30EA\u30B5\u30A4\u30BA",backgroundColor:"\u30DA\u30FC\u30B8\u306E\u80CC\u666F\u8272",pixelizePixelSize:"\u30E2\u30B6\u30A4\u30AF\u306E\u30B5\u30A4\u30BA",language:"\u8A00\u8A9E",wrongPixelSizeValue:`\u30E2\u30B6\u30A4\u30AF\u306E\u30B5\u30A4\u30BA\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002\u6B21\u306E\u3088\u3046\u306B\u6307\u5B9A\u3057\u3066\u3044\u304F\u3060\u3055\u3044\uFF1A
 "20%"\uFF08\u30E2\u30B6\u30A4\u30AF\u30B5\u30A4\u30BA\u306F\u9078\u629E\u7BC4\u56F2\u306E1/5\u306B\u306A\u308A\u307E\u3059\uFF09
 "4"\uFF084px\u3092\u610F\u5473\u3057\u307E\u3059\uFF09
`,tools:{crop:"\u5207\u308A\u629C\u304D",pixelize:"\u30E2\u30B6\u30A4\u30AF",rect:"\u56DB\u89D2\u5F62\u3092\u63CF\u304F",ellipse:"\u5186\u3092\u63CF\u304F",line:"\u7DDA\u3092\u63CF\u304F",arrow:"\u77E2\u5370\u3092\u63CF\u304F",rotate:"\u753B\u50CF\u3092\u56DE\u8EE2",save:"\u753B\u50CF\u3092\u4FDD\u5B58",load:"\u753B\u50CF\u3092\u8AAD\u307F\u8FBC\u307F",text:"\u30C6\u30AD\u30B9\u30C8\u3092\u914D\u7F6E",brush:"\u30D6\u30E9\u30B7",resize:"\u30EA\u30B5\u30A4\u30BA\u307E\u305F\u306F\u30B9\u30B1\u30FC\u30EB",open:"\u753B\u50CF\u3092\u958B\u304F",select:"\u7BC4\u56F2\u9078\u629E",close:"Painterro\u3092\u9589\u3058\u308B",eraser:"\u6D88\u3057\u30B4\u30E0",settings:"\u8A2D\u5B9A",undo:"\u5143\u306B\u623B\u3059",redo:"\u3084\u308A\u76F4\u3059"},pasteOptions:{fit:"\u3059\u3079\u3066\u3092\u7F6E\u304D\u63DB\u3048",extend_down:"\u4E0B\u306B\u62E1\u5F35",extend_right:"\u53F3\u306B\u62E1\u5F35",extend:"\u62E1\u5F35",over:"\u91CD\u306D\u3066\u8CBC\u308A\u4ED8\u3051",how_to_paste:"\u3069\u3046\u8CBC\u308A\u4ED8\u3051\u308B\uFF1F"}},ci={lineColor:"L",lineColorFull:"Lijnkleur",fillColor:"V",fillColorFull:"Vulkleur",alpha:"A",alphaFull:"Alpha",lineWidth:"D",lineWidthFull:"Lijndikte",arrowLength:"L",arrowLengthFull:"Pijllengte",eraserWidth:"G",eraserWidthFull:"Gumdikte",textColor:"K",textColorFull:"Tekstkleur",fontSize:"G",fontSizeFull:"Tekstgrootte",fontStrokeSize:"St",fontStrokeSizeFull:"Streepdikte",fontIsBold:"<b>V</b>",fontIsBoldFull:"Vetgedrukt",fontIsItalic:"<i>C</i>",fontIsItalicFull:"Cursief",shadowOn:"S",shadowOnFull:"Schaduw",fontStrokeAndShadow:"D&S",fontStrokeAndShadowFull:"Streep & Schaduw",fontName:"F",fontNameFull:"Naam lettertype",textStrokeColor:"SK",textStrokeColorFull:"Streepkleur",apply:"Toepassen",cancel:"Annuleren",close:"Sluiten",clear:"Opnieuw",width:"Breedte",height:"Hoogte",keepRatio:"Behoud breedte-/hoogteverhouding",fillPageWith:"Vul pagina met de huidige achtergrondkleur",pixelSize:"P",pixelSizeFull:"Pixelgrootte",resizeScale:"Schalen",resizeResize:"Grootte aanpassen",backgroundColor:"Achtergrondkleur pagina",pixelizePixelSize:"Pixelgrootte pixel",language:"Taal",wrongPixelSizeValue:"Foute pixelgrootte. Je kunt b.v. '20%' invullen, wat een pixelgrootte van 1/5 van de geselecteerde gebiedszijde betekent, of '4' voor een pixelgrootte van 4 px",tools:{crop:"Afbeelding bijsnijden naar geselecteerde gebied",pixelize:"Geselecteerde gebied pixelen",rect:"Teken rechthoek",ellipse:"Teken ovaal",line:"Teken lijn",arrow:"Teken pijl",rotate:"Afbeelding draaien",save:"Afbeelding opslaan",load:"Afbeelding laden",text:"Text schrijven",brush:"Penseel",resize:"Grootte aanpassen",open:"Afbeelding openen",select:"Gebied selecteren",close:"Painterro sluiten",eraser:"Gum",settings:"Instellingen",zoomin:"Inzoomen",zoomout:"Uitzoomen",undo:"Ongedaan maken",redo:"Opnieuw doen"},pasteOptions:{fit:"Vervang alles",extend_down:"Onder uitbreiden",extend_right:"Rechts uitbreiden",extend_left:"Links uitbreiden",extend_top:"Boven uitbreiden",extend:"Uitbreiden",over:"Overheen plakken",how_to_paste:"Hoe te plakken?"}},sn={lineColor:"\u041A\u041B",lineColorFull:"\u041A\u043E\u043B\u0456\u0440 \u043B\u0456\u043D\u0456\u0457",fillColor:"\u041A\u0417",fillColorFull:"\u041A\u043E\u043B\u0456\u0440 \u0437\u0430\u043B\u0438\u0432\u043A\u0438",alpha:"\u041F\u0440",alphaFull:"\u041F\u0440\u043E\u0437\u043E\u0440\u0456\u0441\u0442\u044C",lineWidth:"\u0422\u041B",lineWidthFull:"\u0422\u043E\u0432\u0449\u0438\u043D\u0430 \u043B\u0456\u043D\u0456\u0457",arrowLength:"\u0414\u041B",arrowLengthFull:"\u0414\u043E\u0432\u0436\u0438\u043D\u0430 \u0441\u0442\u0440\u0456\u043B\u043A\u0438",eraserWidth:"\u0428\u0413",eraserWidthFull:"\u0428\u0438\u0440\u0438\u043D\u0430 \u0433\u0443\u043C\u043A\u0438",textColor:"\u041A\u0422",textColorFull:"\u041A\u043E\u043B\u0456\u0440 \u0442\u0435\u043A\u0441\u0442\u0443",fontSize:"\u0420\u0428",fontSizeFull:"\u0420\u043E\u0437\u043C\u0456\u0440 \u0448\u0440\u0438\u0444\u0442\u0443",fontStrokeSize:"\u0422\u0428",fontStrokeSizeFull:"\u0428\u0438\u0440\u0438\u043D\u0430 \u0448\u0440\u0438\u0444\u0442\u0443",fontIsBold:"<b>B</b>",fontIsBoldFull:"\u0416\u0438\u0440\u043D\u0438\u0439",fontIsItalic:"<i>I</i>",fontIsItalicFull:"\u041A\u0443\u0440\u0441\u0438\u0432",shadowOn:"\u0422",shadowOnFull:"\u0422\u0456\u043D\u044C",filtersFull:"\u0424\u0456\u043B\u044C\u0442\u0440\u0438",fontStrokeAndShadow:"\u0422+\u041E",fontStrokeAndShadowFull:"\u0422\u0456\u043D\u044C \u0442\u0430 \u043E\u0431\u0432\u043E\u0434\u043A\u0430",filters:"\u0424\u0456\u043B\u044C\u0442\u0440",imageFilters:"\u0424\u0456\u043B\u044C\u0442\u0440\u0438 \u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u043D\u044F",percents:"%",percentsFull:"\u041F\u0440\u043E\u0446\u0435\u043D\u0442\u0438",fontName:"\u041D\u0428",fontNameFull:"\u041D\u0430\u0437\u0432\u0430 \u0448\u0440\u0438\u0444\u0442\u0443",textStrokeColor:"\u041A\u041E",textStrokeColorFull:"\u041A\u043E\u043B\u0456\u0440 \u043E\u0431\u0432\u043E\u0434\u043A\u0438",apply:"\u0417\u0430\u0441\u0442\u043E\u0441\u0443\u0432\u0430\u0442\u0438",cancel:"\u0412\u0456\u0434\u043C\u0456\u043D\u0430",close:"\u0417\u0430\u043A\u0440\u0438\u0442\u0438",clear:"\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u0438",width:"\u0428\u0438\u0440\u0438\u043D\u0430",height:"\u0412\u0438\u0441\u043E\u0442\u0430",keepRatio:"\u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u043F\u0440\u043E\u043F\u043E\u0440\u0446\u0456\u0457 \u0448\u0438\u0440\u0438\u043D\u0438/\u0432\u0438\u0441\u043E\u0442\u0438",fillPageWith:"\u0417\u0430\u043B\u0438\u0442\u0438 \u0441\u0442\u043E\u0440\u0456\u043D\u043A\u0443 \u043F\u043E\u0442\u043E\u0447\u043D\u0438\u043C \u043A\u043E\u043B\u044C\u043E\u0440\u043E\u043C \u0444\u043E\u043D\u0443",pixelSize:"\u0420\u041F",pixelSizeFull:"\u0420\u043E\u0437\u043C\u0456\u0440 \u043F\u0456\u043A\u0441\u0435\u043B\u044F",resizeScale:"\u041C\u0430\u0441\u0448\u0442\u0430\u0431",resizeResize:"\u0417\u043C\u0456\u043D\u0438\u0442\u0438 \u0440\u043E\u0437\u043C\u0456\u0440",backgroundColor:"\u041A\u043E\u043B\u0456\u0440 \u0444\u043E\u043D\u0443 \u0441\u0442\u043E\u0440\u0456\u043D\u043A\u0438",pixelizePixelSize:"\u0420\u043E\u0437\u043C\u0438\u0442\u0438 \u043F\u0456\u043A\u0441\u0435\u043B\u0456 \u0440\u043E\u0437\u043C\u0456\u0440\u043E\u043C",language:"\u041C\u043E\u0432\u0430",wrongPixelSizeValue:"\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0438\u0439 \u0440\u043E\u0437\u043C\u0456\u0440 \u043F\u0456\u043A\u0441\u0435\u043B\u044F. \u0412\u0438 \u043C\u043E\u0436\u0435\u0442\u0435 \u0432\u0432\u0435\u0441\u0442\u0438, \u043D\u0430\u043F\u0440\u0438\u043A\u043B\u0430\u0434, '20%', \u0449\u043E \u043E\u0437\u043D\u0430\u0447\u0430\u0454, \u0449\u043E \u0441\u0435\u0440\u0435\u0434\u043D\u0456\u0439 \u0440\u043E\u0437\u043C\u0456\u0440 \u043F\u0456\u043A\u0441\u0435\u043B\u044F \u0431\u0443\u0434\u0435 1/5 \u0432\u0456\u0434 \u0441\u0442\u043E\u0440\u043E\u043D\u0438 \u0432\u0438\u0431\u0440\u0430\u043D\u043E\u0457 \u043E\u0431\u043B\u0430\u0441\u0442\u0456, \u0430\u0431\u043E '4', \u0449\u043E \u043E\u0437\u043D\u0430\u0447\u0430\u0454 4 \u043F\u0456\u043A\u0441\u0435\u043B\u044F",tools:{crop:"\u041E\u0431\u0440\u0456\u0437\u0430\u0442\u0438 \u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u043D\u044F \u0434\u043E \u0432\u0438\u0434\u0456\u043B\u0435\u043D\u043E\u0457 \u043E\u0431\u043B\u0430\u0441\u0442\u0456",pixelize:"\u0417\u0440\u043E\u0431\u0438\u0442\u0438 \u043F\u0456\u043A\u0441\u0435\u043B\u0456\u0437\u0430\u0446\u0456\u044E \u0432\u0438\u0434\u0456\u043B\u0435\u043D\u043E\u0457 \u043E\u0431\u043B\u0430\u0441\u0442\u0456",rect:"\u041D\u0430\u043C\u0430\u043B\u044E\u0432\u0430\u0442\u0438 \u043F\u0440\u044F\u043C\u043E\u043A\u0443\u0442\u043D\u0438\u043A",ellipse:"\u041D\u0430\u043C\u0430\u043B\u044E\u0432\u0430\u0442\u0438 \u0435\u043B\u0456\u043F\u0441",line:"\u041D\u0430\u043C\u0430\u043B\u044E\u0432\u0430\u0442\u0438 \u043B\u0456\u043D\u0456\u044E",arrow:"\u041D\u0430\u043C\u0430\u043B\u044E\u0432\u0430\u0442\u0438 \u0441\u0442\u0440\u0456\u043B\u043A\u0443",rotate:"\u041F\u043E\u0432\u0435\u0440\u043D\u0443\u0442\u0438 ",save:"\u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438 ",load:"\u0417\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0438\u0442\u0438 ",text:"\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u0438 \u0442\u0435\u043A\u0441\u0442",brush:"\u041F\u0435\u043D\u0437\u0435\u043B\u044C",resize:"\u0417\u043C\u0456\u043D\u0438\u0442\u0438 \u0440\u043E\u0437\u043C\u0456\u0440 \u0430\u0431\u043E \u043C\u0430\u0441\u0448\u0442\u0430\u0431",open:"\u0412\u0456\u0434\u043A\u0440\u0438\u0442\u0438 \u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u043D\u044F",select:"\u0412\u0438\u0431\u0440\u0430\u0442\u0438 \u043E\u0431\u043B\u0430\u0441\u0442\u044C",close:"\u0417\u0430\u043A\u0440\u0438\u0442\u0438",eraser:"\u041B\u0430\u0441\u0442\u0438\u043A",settings:"\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F",zoomin:"\u041D\u0430\u0431\u043B\u0438\u0437\u0438\u0442\u0438",zoomout:"\u0412\u0456\u0434\u0434\u0430\u043B\u0438\u0442\u0438",undo:"\u0421\u043A\u0430\u0441\u0443\u0432\u0430\u0442\u0438",redo:"\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0438",clear:"\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u0438",bucket:"\u0417\u0430\u043B\u0438\u0432\u043A\u0430",filters:"\u0424\u0456\u043B\u044C\u0442\u0440\u0438"},pasteOptions:{fit:"\u0417\u0430\u043C\u0456\u043D\u0438\u0442\u0438 \u0432\u0441\u0435",extend_down:"\u0414\u043E\u0434\u0430\u0442\u0438 \u0432\u043D\u0438\u0437",extend_right:"\u0414\u043E\u0434\u0430\u0442\u0438 \u0432\u043F\u0440\u0430\u0432\u043E",extend_left:"\u0414\u043E\u0434\u0430\u0442\u0438 \u0432\u043B\u0456\u0432\u043E",extend_top:"\u0414\u043E\u0434\u0430\u0442\u0438 \u0432\u0433\u043E\u0440\u0443",extend:"\u0414\u043E\u0434\u0430\u0442\u0438",over:"\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u0438",how_to_paste:"\u042F\u043A \u0432\u0441\u0442\u0430\u0432\u0438\u0442\u0438?"}},Br=null;class Ke{constructor(){this.translations={de:ge,en:De,es:Pe,ca:Dr,fr:Pr,pl:_r,"pt-PT":Yr,"pt-BR":jr,ru:si,ja:Ai,nl:ci,uk:sn},this.defaultTranslator=this.translations.en}static get(){return Br||(Br=new Ke,Br)}addTranslation(n,i){this.translations[n]=i}activate(n){this.translations[n]!==void 0?(this.trans=n,this.translator=this.translations[this.trans]):this.translator=this.defaultTranslator}tr(n){let i=n.split("."),c=this.translator,l=this.defaultTranslator;return i.forEach((f=>{l=l[f],c!==void 0&&(c=c[f])})),c||l}}function Ct(j){return Ke.get().tr(j)}function sr(j){let n=/^#?([a-fA-F\d]{2})([a-fA-F\d]{2})([a-fA-F\d]{2})$/i.exec(j);return n?{r:parseInt(n[1],16),g:parseInt(n[2],16),b:parseInt(n[3],16)}:(n=/^#?([a-fA-F\d])([a-fA-F\d])([a-fA-F\d])$/i.exec(j),n?{r:parseInt(n[1].repeat(2),16),g:parseInt(n[2].repeat(2),16),b:parseInt(n[3].repeat(2),16)}:void 0)}function _e(j,n){let i=sr(j);return`rgba(${i.r},${i.g},${i.b},${n})`}function vr(j){let n=j.toString(16);return n.length===1&&`0${n}`||n}function br(j,n,i){return`#${vr(j)}${vr(n)}${vr(i)}`}class An{constructor(n,i){this.callback=i,this.main=n,this.w=180,this.h=150;let c=this.w,l=this.h;this.lightPosition=this.w-1,this.wrapper=n.wrapper.querySelector(".ptro-color-widget-wrapper"),this.input=n.wrapper.querySelector(".ptro-color-widget-wrapper .ptro-color"),this.pipetteButton=n.wrapper.querySelector(".ptro-color-widget-wrapper button.ptro-pipette"),this.closeButton=n.wrapper.querySelector(".ptro-color-widget-wrapper button.ptro-close-color-picker"),this.canvas=n.wrapper.querySelector(".ptro-color-widget-wrapper canvas"),this.ctx=this.canvas.getContext("2d"),this.canvasLight=n.wrapper.querySelector(".ptro-color-widget-wrapper .ptro-canvas-light"),this.colorRegulator=n.wrapper.querySelector(".ptro-color-widget-wrapper .ptro-color-light-regulator"),this.canvasAlpha=n.wrapper.querySelector(".ptro-color-widget-wrapper .ptro-canvas-alpha"),this.alphaRegulator=n.wrapper.querySelector(".ptro-color-widget-wrapper .ptro-color-alpha-regulator"),this.ctxLight=this.canvasLight.getContext("2d"),this.ctxAlpha=this.canvasAlpha.getContext("2d"),this.canvas.setAttribute("width",`${c}`),this.canvas.setAttribute("height",`${l}`),this.canvasLight.setAttribute("width",`${c}`),this.canvasLight.setAttribute("height","20"),this.canvasAlpha.setAttribute("width",`${c}`),this.canvasAlpha.setAttribute("height","20");let f=this.ctx.createLinearGradient(0,0,c,0);f.addColorStop(.06666666666666667,"#ff0000"),f.addColorStop(.26666666666666666,"#ffff00"),f.addColorStop(.3333333333333333,"#00ff00"),f.addColorStop(.6,"#00ffff"),f.addColorStop(.8,"#0000ff"),f.addColorStop(.9333333333333333,"#ff00ff"),this.ctx.fillStyle=f,this.ctx.fillRect(0,0,c,l);let C=this.ctx.createLinearGradient(0,0,0,l);C.addColorStop(0,"rgba(0, 0, 0, 0)"),C.addColorStop(.99,"rgba(0, 0, 0, 1)"),C.addColorStop(1,"rgba(0, 0, 0, 1)"),this.ctx.fillStyle=C,this.ctx.fillRect(0,0,c,l),this.closeButton.onclick=()=>{this.close()},this.pipetteButton.onclick=()=>{this.wrapper.setAttribute("hidden","true"),this.opened=!1,this.choosing=!0},this.input.onkeyup=()=>{this.setActiveColor(this.input.value,!0)}}open(n,i){this.target=n.target,this.palleteColor=n.palleteColor,this.alpha=n.alpha,this.lightPosition=this.lightPosition||this.w-1,this.drawLighter(),this.colorRegulator.style.left=`${this.lightPosition}px`,this.alphaRegulator.style.left=`${Math.round(this.alpha*this.w)}px`,this.regetColor(),this.wrapper.removeAttribute("hidden"),this.opened=!0,this.addCallback=i}close(){this.wrapper.setAttribute("hidden","true"),this.opened=!1}getPaletteColorAtPoint(n){let i=n.clientX-this.canvas.documentOffsetLeft,c=n.clientY-this.canvas.documentOffsetTop;i=i<1?1:i,c=c<1?1:c,i=i>this.w&&this.w-1||i,c=c>this.h&&this.h-1||c;let l=this.ctx.getImageData(i,c,1,1).data;this.palleteColor=br(l[0],l[1],l[2]),this.drawLighter(),this.regetColor()}regetColor(){let n=this.ctxLight.getImageData(this.lightPosition,5,1,1).data;this.setActiveColor(br(n[0],n[1],n[2])),this.drawAlpher()}regetAlpha(){let n=this.ctxAlpha.getImageData(this.alphaPosition,5,1,1).data;this.alpha=n[3]/255,this.setActiveColor(this.color,!0)}getColorLightAtClick(n){let i=n.clientX-this.canvasLight.documentOffsetLeft;i=i<1?1:i,i=i>this.w-1&&this.w-1||i,this.lightPosition=i,this.colorRegulator.style.left=`${i}px`,this.regetColor()}getAlphaAtClick(n){let i=n.clientX-this.canvasAlpha.documentOffsetLeft;i=i<1?1:i,i=i>this.w-1&&this.w-1||i,this.alphaPosition=i,this.alphaRegulator.style.left=`${i}px`,this.regetAlpha()}handleKeyDown(n){return!(!this.opened||n.keyCode!==mt.enter)||!(!this.opened||n.keyCode!==mt.esc)&&(this.close(),!0)}handleMouseDown(n){return this.choosing&&n.button!==2?(this.choosingActive=!0,this.handleMouseMove(n),!0):(this.choosing=!1,n.target===this.canvas&&(this.selecting=!0,this.getPaletteColorAtPoint(n)),n.target!==this.canvasLight&&n.target!==this.colorRegulator||(this.lightSelecting=!0,this.getColorLightAtClick(n)),n.target!==this.canvasAlpha&&n.target!==this.alphaRegulator||(this.alphaSelecting=!0,this.getAlphaAtClick(n)),!1)}handleMouseMove(n){if(this.opened)this.selecting&&this.getPaletteColorAtPoint(n),this.lightSelecting&&this.getColorLightAtClick(n),this.alphaSelecting&&this.getAlphaAtClick(n);else if(this.choosingActive){let i=this.main.getScale(),c=(n.clientX-this.main.elLeft()+this.main.scroller.scrollLeft)*i;c=c<1?1:c,c=c>this.main.size.w-1&&this.main.size.w-1||c;let l=(n.clientY-this.main.elTop()+this.main.scroller.scrollTop)*i;l=l<1?1:l,l=l>this.main.size.h-1&&this.main.size.h-1||l;let f=this.main.ctx.getImageData(c,l,1,1).data,C=br(f[0],f[1],f[2]);this.callback({alphaColor:_e(C,1),lightPosition:this.w-1,alpha:1,palleteColor:C,target:this.target}),this.addCallback!==void 0&&this.addCallback({alphaColor:_e(C,1),lightPosition:this.w-1,alpha:1,palleteColor:C,target:this.target})}}handleMouseUp(){this.selecting=!1,this.lightSelecting=!1,this.choosing=!1,this.choosingActive=!1,this.alphaSelecting=!1,this.main.zoomHelper.hideZoomHelper()}setActiveColor(n,i){try{this.input.style.color=(function(c){let l=sr(c);return(299*l.r+587*l.g+114*l.b)/1e3>=128?"black":"white"})(n)}catch{return}this.input.style["background-color"]=n,i===void 0&&(this.input.value=n),this.color=n,this.alphaColor=_e(n,this.alpha),this.callback!==void 0&&this.opened&&this.callback({alphaColor:this.alphaColor,lightPosition:this.lightPosition,alpha:this.alpha,palleteColor:this.color,target:this.target}),this.addCallback!==void 0&&this.opened&&this.addCallback({alphaColor:this.alphaColor,lightPosition:this.lightPosition,alpha:this.alpha,palleteColor:this.color,target:this.target})}static html(){return`<div class="ptro-color-widget-wrapper ptro-common-widget-wrapper ptro-v-middle" hidden><div class="ptro-pallet ptro-color-main ptro-v-middle-in"><canvas></canvas><canvas class="ptro-canvas-light"></canvas><span class="ptro-color-light-regulator ptro-bordered-control"></span><canvas class="ptro-canvas-alpha"></canvas><span class="alpha-checkers"></span><span class="ptro-color-alpha-regulator ptro-bordered-control"></span><div class="ptro-colors"></div><div class="ptro-color-edit"><button type="button" aria-label="pipette" class="ptro-icon-btn ptro-pipette ptro-color-control" style="float: left; margin-right: 5px"><i class="ptro-icon ptro-icon-pipette"></i></button><input class="ptro-input ptro-color" type="text" size="7"/><button type="button" aria-label="close" class="ptro-named-btn ptro-close-color-picker ptro-color-control" >${Ct("close")}</button></div></div></div>`}drawLighter(){let n=this.ctxLight.createLinearGradient(0,0,this.w,0);n.addColorStop(0,"#ffffff"),n.addColorStop(.05,"#ffffff"),n.addColorStop(.95,this.palleteColor),n.addColorStop(1,this.palleteColor),this.ctxLight.fillStyle=n,this.ctxLight.fillRect(0,0,this.w,15)}drawAlpher(){this.ctxAlpha.clearRect(0,0,this.w,15);let n=this.ctxAlpha.createLinearGradient(0,0,this.w,0);n.addColorStop(0,"rgba(255,255,255,0)"),n.addColorStop(.05,"rgba(255,255,255,0)"),n.addColorStop(.95,this.color),n.addColorStop(1,this.color),this.ctxAlpha.fillStyle=n,this.ctxAlpha.fillRect(0,0,this.w,15)}}let cn="painterro-data",xt={};function Dt(j,n){xt[j]=n;try{localStorage.setItem(cn,JSON.stringify(xt))}catch(i){console.warn(`Unable save to localstorage: ${i}`)}}function Kt(...j){for(let n=0;n<j.length;n+=1)if(j[n]!==void 0)return j[n]}function hn(j,n){(function(){try{xt=JSON.parse(localStorage.getItem(cn))}catch(l){console.warn(`Unable get from localStorage: ${l}`)}xt||(xt={})})();let i=j||{};var c;if(i.language&&(c=i.language,Ke.get().activate(c)),i.NON_SELECTABLE_TOOLS=["pixelize","crop","rotate"],i.activeColor=xt.activeColor||i.activeColor||"#ff0000",i.activeColorAlpha=Kt(xt.activeColorAlpha,i.activeColorAlpha,1),i.activeAlphaColor=_e(i.activeColor,i.activeColorAlpha),i.activeFillColor=xt.activeFillColor||i.activeFillColor||"#000000",i.activeFillColorAlpha=Kt(xt.activeFillColorAlpha,i.activeFillColorAlpha,0),i.activeFillAlphaColor=_e(i.activeFillColor,i.activeFillColorAlpha),i.replace_all_on_empty_background=i.initText=i.initText||null,i.initTextColor=i.initTextColor||"#808080",i.initTextStyle=i.initTextStyle||"26px 'Open Sans', sans-serif",i.defaultLineWidth=xt.defaultLineWidth||i.defaultLineWidth||5,i.defaultPrimitiveShadowOn=Kt(xt.defaultPrimitiveShadowOn,i.defaultPrimitiveShadowOn,!0),i.defaultArrowLength=xt.defaultArrowLength||i.defaultArrowLength||32,i.defaultEraserWidth=Kt(xt.defaultEraserWidth,i.defaultEraserWidth,5),i.defaultFontSize=Kt(xt.defaultFontSize,i.defaultFontSize,24),i.defaultFontBold=Kt(xt.defaultFontBold,i.defaultFontBold,!1),i.defaultFontItalic=Kt(xt.defaultFontItalic,i.defaultFontItalic,!1),i.replaceAllOnEmptyBackground=Kt(i.replaceAllOnEmptyBackground,!0),i.backgroundFillColor=xt.backgroundFillColor||i.backgroundFillColor||"#ffffff",i.backgroundFillColorAlpha=i.backplateImgUrl?0:Kt(xt.backgroundFillColorAlpha,i.backgroundFillColorAlpha,1),i.backgroundFillAlphaColor=_e(i.backgroundFillColor,i.backgroundFillColorAlpha),i.textStrokeColor=xt.textStrokeColor||i.textStrokeColor||"#ffffff",i.textStrokeColorAlpha=Kt(xt.textStrokeColorAlpha,i.textStrokeColorAlpha,1),i.textStrokeAlphaColor=_e(i.textStrokeColor,i.textStrokeColorAlpha),i.shadowScale=Kt(i.shadowScale,1),i.defaultTextStrokeAndShadow=Kt(xt.defaultTextStrokeAndShadow,i.defaultTextStrokeAndShadow,!0),i.worklogLimit=Kt(i.worklogLimit,100),i.hiddenTools=i.hiddenTools||["redo","zoomin","zoomout"],i.hiddenTools.forEach((l=>{n.includes(l)||fe(`Hidden tool with name ${l}`)})),i.defaultTool?i.hiddenTools.includes(i.defaultTool)&&(fe(`Can't hide default tool '${i.defaultTool}', please change default tool to another to hide it`),i.hiddenTools.splice(defaultInHiddenIndex,1)):i.defaultTool=n.filter((l=>!i.hiddenTools.includes(l)&&!i.NON_SELECTABLE_TOOLS.includes(l)))[0],i.pixelizePixelSize=xt.pixelizePixelSize||i.pixelizePixelSize||"20%",i.colorScheme=i.colorScheme||{},i.colorScheme.main=i.colorScheme.main||"#fff",i.colorScheme.control=i.colorScheme.control||"#fff",i.colorScheme.controlShadow=i.colorScheme.controlShadow||"0px 0px 3px 1px #bbb",i.colorScheme.controlContent=i.colorScheme.controlContent||"#000000",i.colorScheme.hoverControl=i.colorScheme.hoverControl||i.colorScheme.control,i.colorScheme.hoverControlContent=i.colorScheme.hoverControlContent||"#1a3d67",i.colorScheme.toolControlNameColor=i.colorScheme.toolControlNameColor||"rgba(0,0,0,0.07)",i.colorScheme.activeControl=i.colorScheme.activeControl||"#7485B1",i.colorScheme.activeControlContent=i.colorScheme.activeControlContent||i.colorScheme.main,i.colorScheme.inputBorderColor=i.colorScheme.inputBorderColor||i.colorScheme.main,i.colorScheme.inputBackground=i.colorScheme.inputBackground||"#ffffff",i.colorScheme.inputShadow=i.colorScheme.inputShadow||"inset 0 0 4px 1px #ccc",i.colorScheme.inputText=i.colorScheme.inputText||i.colorScheme.activeControl,i.colorScheme.backgroundColor=i.colorScheme.backgroundColor||"#999999",i.colorScheme.dragOverBarColor=i.colorScheme.dragOverBarColor||"#899dff",i.defaultSize=i.defaultSize||"fill",i.defaultPixelSize=i.defaultPixelSize||4,i.disableWheelZoom=i.disableWheelZoom||!1,i.extraFonts=i.extraFonts||[],i.toolbarHeightPx=i.toolbarHeightPx||40,i.buttonSizePx=i.buttonSizePx||32,i.bucketSensivity=i.bucketSensivity||100,typeof i.defaultSize!="object")if(i.defaultSize==="fill")i.defaultSize={width:"fill",height:"fill"};else{let l=i.defaultSize.split("x");i.defaultSize={width:Mt(l[0]),height:Mt(l[1])}}if(i.toolbarPosition=i.toolbarPosition||"bottom",i.fixMobilePageReloader=i.fixMobilePageReloader===void 0||i.fixMobilePageReloader,i.translation){let l=i.translation.name;Ke.get().addTranslation(l,i.translation.strings),Ke.get().activate(l)}return i.styles=`.ptro-color-main{
      background-color:${i.colorScheme.main};
      color:${i.colorScheme.controlContent};
    }
    .ptro-color-control{
      box-shadow:${i.colorScheme.controlShadow};
      background-color:${i.colorScheme.control};
      color:${i.colorScheme.controlContent}}
    .ptro-tool-ctl-name{
      background-color:${i.colorScheme.toolControlNameColor};
    }
    button.ptro-color-control:hover:not(.ptro-color-active-control):not([disabled]){
        background-color: ${i.colorScheme.hoverControl};
        color:${i.colorScheme.hoverControlContent}}    
    .ptro-bordered-control{border-color: ${i.colorScheme.activeControl}}
    input.ptro-input,.ptro-check,input.ptro-input:focus,select.ptro-input,select.ptro-input:focus {
      border: 1px solid ${i.colorScheme.inputBorderColor};
      background-color: ${i.colorScheme.inputBackground};
      color: ${i.colorScheme.inputText};
      box-shadow:${i.colorScheme.inputShadow};
    }
    .ptro-bar-dragover{background-color:${i.colorScheme.dragOverBarColor}}
    .ptro-color,.ptro-bordered-btn{
      border: 1px solid ${i.colorScheme.inputBorderColor};
    }
    .ptro-color-control:active:enabled {
        background-color: ${i.colorScheme.activeControl};
        color: ${i.colorScheme.activeControlContent}}
    .ptro-color-active-control{
        background-color: ${i.colorScheme.activeControl};
        color:${i.colorScheme.activeControlContent}}
    .ptro-wrapper{
      background-color:${i.colorScheme.backgroundColor};
      bottom:${i.toolbarPosition==="top"?"0":i.toolbarHeightPx}px;
      top:${i.toolbarPosition==="top"?i.toolbarHeightPx:"0"}px;
    }
    .ptro-icon-btn {
      height: ${i.buttonSizePx}px;
      width: ${i.buttonSizePx}px;
      margin: 0 0 0 ${(i.toolbarHeightPx-i.buttonSizePx)/2}px;
    }
    .ptro-bar-right {
      margin-right: ${(i.toolbarHeightPx-i.buttonSizePx)/2}px;
    }
    .ptro-bar {
      height: ${i.toolbarHeightPx}px;
      ${i.toolbarPosition==="top"?"top":"bottom"}: 0;
    }`,i}class pn{constructor(n){this.main=n,this.zomer=n.wrapper.querySelector(".ptro-zoomer"),this.zomerCtx=this.zomer.getContext("2d"),this.canvas=this.main.canvas,this.ctx=this.main.ctx,this.wrapper=this.main.wrapper,this.gridColor=this.zomerCtx.createImageData(1,1),this.gridColor.data[0]=255,this.gridColor.data[1]=255,this.gridColor.data[2]=255,this.gridColor.data[3]=255,this.gridColorRed=this.zomerCtx.createImageData(1,1),this.gridColorRed.data[0]=255,this.gridColorRed.data[1]=0,this.gridColorRed.data[2]=0,this.gridColorRed.data[3]=255,this.captW=7,this.middle=Math.ceil(this.captW/2)-1,this.periodW=8,this.fullW=this.captW*this.periodW,this.halfFullW=this.fullW/2,this.zomer.setAttribute("width",this.fullW),this.zomer.setAttribute("height",this.fullW),this.cursor=this.wrapper.style.cursor}handleMouseMove(n){if(this.main.colorPicker.choosing&&!n.altKey){this.shown||(this.shown=!0,this.zomer.style.display="block",this.cursor=this.wrapper.style.cursor,this.wrapper.style.cursor="none");let i=this.main.getScale(),c=[n.clientX-this.main.elLeft()+this.main.scroller.scrollLeft,n.clientY-this.main.elTop()+this.main.scroller.scrollTop],l=c[0]*i;l=l<1?1:l,l=l>this.main.size.w-1?this.main.size.w-1:l;let f=c[1]*i;f=f<1?1:f,f=f>this.main.size.h-1?this.main.size.h-1:f;let C=this.captW,p=this.periodW;for(let w=0;w<C;w+=1)for(let W=0;W<C;W+=1){let ot=this.ctx.getImageData(l+w-this.middle,f+W-this.middle,1,1);for(let zt=0;zt<p;zt+=1)for(let Bt=0;Bt<p;Bt+=1)zt===p-1||Bt===p-1?w===this.middle&&W===this.middle||w===this.middle&&W===this.middle-1&&Bt===p-1||w===this.middle-1&&W===this.middle&&zt===p-1?this.zomerCtx.putImageData(this.gridColorRed,w*p+zt,W*p+Bt):this.zomerCtx.putImageData(this.gridColor,w*p+zt,W*p+Bt):this.zomerCtx.putImageData(ot,w*p+zt,W*p+Bt)}this.zomer.style.left=n.clientX-this.wrapper.documentOffsetLeft-this.halfFullW+"px",this.zomer.style.top=n.clientY-this.wrapper.documentOffsetTop-this.halfFullW+"px"}else this.shown&&this.hideZoomHelper()}hideZoomHelper(){this.zomer.style.display="none",this.wrapper.style.cursor=this.cursor,this.shown=!1}static html(){return'<canvas class="ptro-zoomer" width="" height="0"></canvas>'}}var hi=S(306),pi=S.n(hi);class un{constructor(n){this.ctx=n.ctx,this.el=n.toolContainer,this.main=n,this.wrapper=n.wrapper,this.input=this.el.querySelector(".ptro-text-tool-input"),this.inputWrapper=this.el.querySelector(".ptro-text-tool-input-wrapper"),this.inputWrapper.style.display="none",this.isBold=n.params.defaultFontBold,this.isItalic=n.params.defaultFontItalic,this.strokeOn=n.params.defaultTextStrokeAndShadow,this.strokeColor=n.params.textStrokeAlphaColor,this.setFontSize(n.params.defaultFontSize),this.setFont(this.getFonts()[0].value),this.setFontIsBold(this.isBold),this.setFontIsItalic(this.isItalic),this.el.querySelector(".ptro-text-tool-apply").onclick=()=>{this.apply()},this.el.querySelector(".ptro-text-tool-cancel").onclick=()=>{this.close()}}getFont(){return this.font}getFonts(){let n=["Arial, Helvetica, sans-serif",'"Arial Black", Gadget, sans-serif','"Comic Sans MS", cursive, sans-serif',"Impact, Charcoal, sans-serif",'"Lucida Sans Unicode", "Lucida Grande", sans-serif',"Tahoma, Geneva, sans-serif",'"Trebuchet MS", Helvetica, sans-serif',"Verdana, Geneva, sans-serif",'"Courier New", Courier, monospace','"Lucida Console", Monaco, monospace',...this.main.params.extraFonts],i=[];return n.forEach((c=>{let l=c.split(",")[0].replace(/"/g,"");i.push({value:c,name:l,extraStyle:`font-family:${c}`,title:l})})),i}setFont(n){this.font=n,this.input.style["font-family"]=n,this.active&&this.input.focus(),this.active&&this.reLimit()}setStrokeOn(n){this.strokeOn=n,this.setStrokeParams()}setFontIsBold(n){this.isBold=n,this.input.style["font-weight"]=n?"bold":"normal",this.active&&(this.input.focus(),this.reLimit()),this.setStrokeParams()}setFontIsItalic(n){this.isItalic=n,this.input.style["font-style"]=n?"italic":"normal",this.active&&(this.input.focus(),this.reLimit())}setFontSize(n){this.fontSize=n,this.input.style["font-size"]=`${n}px`,this.setStrokeParams(),this.active&&this.reLimit()}setStrokeParams(){this.strokeOn?this.input.style["text-shadow"]=`
      -1px -1px 1px ${this.strokeColor},1px -1px 1px ${this.strokeColor},
      -1px  1px 1px ${this.strokeColor},1px  1px 1px ${this.strokeColor},
      1px 1px ${Math.log(this.fontSize)*this.main.params.shadowScale}px black`:this.input.style["text-shadow"]="none"}setFontColor(n){this.color=n,this.input.style.color=n,this.input.style["outline-color"]=n}inputLeft(){return this.input.documentOffsetLeft+this.main.scroller.scrollLeft}inputTop(){return this.input.documentOffsetTop+this.main.scroller.scrollTop}reLimit(){this.inputWrapper.style.right="auto",this.inputLeft()+this.input.clientWidth>this.main.elLeft()+this.el.clientWidth?this.inputWrapper.style.right="0":this.inputWrapper.style.right="auto",this.inputWrapper.style.bottom="auto",this.inputTop()+this.input.clientHeight>this.main.elTop()+this.el.clientHeight?this.inputWrapper.style.bottom="0":this.inputWrapper.style.bottom="auto"}handleMouseDown(n){if(n.target.classList[0]==="ptro-crp-el"){this.active||(this.input.innerHTML="<br>",this.pendingClear=!0),this.active=!0,this.crd=[n.clientX-this.main.elLeft()+this.main.scroller.scrollLeft,n.clientY-this.main.elTop()+this.main.scroller.scrollTop];let i=this.main.getScale();this.scaledCord=[this.crd[0]*i,this.crd[1]*i],this.inputWrapper.style.left=`${this.crd[0]}px`,this.inputWrapper.style.top=`${this.crd[1]}px`,this.inputWrapper.style.display="inline",this.input.focus(),this.reLimit(),this.input.onkeydown=c=>{c.ctrlKey&&c.keyCode===mt.enter&&(this.apply(),c.preventDefault()),c.keyCode===mt.esc&&(this.close(),this.main.closeActiveTool(),c.preventDefault()),this.reLimit(),this.pendingClear&&(this.input.innerText=this.input.innerText.slice(1),this.pendingClear=!1),c.stopPropagation()},this.main.isMobile||n.preventDefault()}}apply(){let n=this.input.style.border,i=this.input.style.outline,c=this.main.getScale();this.input.style.border="none";let l={style:{"transform-origin":"top left",transform:`scale(${c})`,"overflow-wrap":"break-word","word-wrap":"break-word","white-space":"pre-wrap",overflow:"hidden",width:this.input.clientWidth+"px",height:this.input.clientHeight+"px"},width:this.input.clientWidth*(c<1?1/c:c),height:this.input.clientHeight*(c<1?1/c:c)};pi().toPng(this.input,l).then((f=>{let C=new Image;C.src=f,C.onload=()=>{this.ctx.drawImage(C,this.scaledCord[0],this.scaledCord[1]),this.input.style.border=n,this.input.style.outline=i,this.close(),this.main.worklog.captureState(),this.main.closeActiveTool()}})).catch((function(f){console.error("oops, something went wrong!",f)}))}close(){this.active=!1,this.inputWrapper.style.display="none"}static code(){return`<span class="ptro-text-tool-input-wrapper"><div contenteditable="true" class="ptro-text-tool-input"></div><span class="ptro-text-tool-buttons"><button type="button" aria-label="apply" class="ptro-text-tool-apply ptro-icon-btn ptro-color-control" title="${Ct("apply")}" 
                   style="margin: 2px"><i class="ptro-icon ptro-icon-apply"></i></button><button type="button" aria-label="close" class="ptro-text-tool-cancel ptro-icon-btn ptro-color-control" title="${Ct("cancel")}"
                   style="margin: 2px"><i class="ptro-icon ptro-icon-close"></i></button></span></span>`}}class Ye{constructor(n){this.main=n,this.wrapper=n.wrapper.querySelector(".ptro-resize-widget-wrapper"),this.inputW=n.wrapper.querySelector(".ptro-resize-widget-wrapper .ptro-resize-width-input"),this.inputH=n.wrapper.querySelector(".ptro-resize-widget-wrapper .ptro-resize-heigth-input"),this.inputWLimit=1e4,this.inputHLimit=13e3,this.linkButton=n.wrapper.querySelector(".ptro-resize-widget-wrapper button.ptro-link"),this.linkButtonIcon=n.wrapper.querySelector(".ptro-resize-widget-wrapper button.ptro-link i"),this.closeButton=n.wrapper.querySelector(".ptro-resize-widget-wrapper button.ptro-close"),this.scaleButton=n.wrapper.querySelector(".ptro-resize-widget-wrapper button.ptro-scale"),this.resizeButton=n.wrapper.querySelector(".ptro-resize-widget-wrapper button.ptro-resize"),this.linked=!0,this.closeButton.onclick=()=>{this.startClose()},this.scaleButton.onclick=()=>{if(!Ye.validationZeroValue(this.newH,this.newW))return;let i=this.main.size.w,c=this.main.size.h,l=this.main.canvas.toDataURL();this.main.resize(this.newW,this.newH),this.main.ctx.save(),this.main.ctx.scale(this.newW/i,this.newH/c);let f=new Image;f.onload=()=>{this.main.ctx.drawImage(f,0,0),this.main.adjustSizeFull(),this.main.ctx.restore(),this.main.worklog.captureState(),this.startClose()},f.src=l},this.resizeButton.onclick=()=>{if(!Ye.validationZeroValue(this.newH,this.newW))return;let i=this.main.canvas.toDataURL();this.main.resize(this.newW,this.newH),this.main.clearBackground();let c=new Image;c.onload=()=>{this.main.ctx.drawImage(c,0,0),this.main.adjustSizeFull(),this.main.worklog.captureState(),this.startClose()},c.src=i},this.linkButton.onclick=()=>{this.linked=!this.linked,this.linked?this.linkButtonIcon.className="ptro-icon ptro-icon-linked":this.linkButtonIcon.className="ptro-icon ptro-icon-unlinked"},this.inputW.oninput=()=>{let i=Number(this.inputW.value);if(this.validationWidth(i),this.linked){let c=this.main.size.ratio;this.newH=Math.round(this.newW/c),this.validationHeight(this.newH),this.inputH.value=this.newH}},this.inputH.oninput=()=>{let i=Number(this.inputH.value);if(this.validationHeight(i),this.linked){let c=this.main.size.ratio;this.newW=Math.round(this.newH*c),this.validationWidth(this.newW),this.inputW.value=+this.newW}}}validationWidthValue(n){return n<=this.inputWLimit}validationHeightValue(n){return n<=this.inputHLimit}static validationEmptyValue(n){return n!==""||n!=="0"}static validationZeroValue(...n){let i=!0;return n.forEach((c=>{i=c!==0&&i})),i}validationHeight(n){if(!this.validationHeightValue(n))return this.inputH.value=this.inputHLimit,void(this.newH=this.inputHLimit);this.newH=n,Ye.validationEmptyValue(n)?this.newH=n:(this.inputH.value=0,this.newH=0)}validationWidth(n){if(!this.validationWidthValue(n))return this.inputW.value=this.inputWLimit,void(this.newW=this.inputWLimit);this.newW=n,Ye.validationEmptyValue(n)?this.newW=n:(this.inputW.value="0",this.newW=0)}open(){this.wrapper.removeAttribute("hidden"),this.opened=!0,this.newW=this.main.size.w,this.newH=this.main.size.h,this.inputW.value=+this.newW,this.inputH.value=+this.newH}close(){this.wrapper.setAttribute("hidden","true"),this.opened=!1}startClose(){this.main.closeActiveTool()}handleKeyDown(n){return n.keyCode===mt.enter||n.keyCode===mt.esc&&(this.startClose(),!0)}static html(){return`<div class="ptro-resize-widget-wrapper ptro-common-widget-wrapper ptro-v-middle" hidden><div class="ptro-resize-widget ptro-color-main ptro-v-middle-in"><div style="display: inline-block"><table><tr><td class="ptro-label ptro-resize-table-left">${Ct("width")}</td><td><input class="ptro-input ptro-resize-width-input" type="number" min="0" max="3000" step="1"/></td></tr><tr><td class="ptro-label ptro-resize-table-left">${Ct("height")}</td><td><input class="ptro-input ptro-resize-heigth-input" type="number" min="0" max="3000" step="1"/></td></tr></table></div><div class="ptro-resize-link-wrapper"><button type="button" aria-label="button resize" class="ptro-icon-btn ptro-link ptro-color-control" title="${Ct("keepRatio")}"><i class="ptro-icon ptro-icon-linked" style="font-size: 18px;"></i></button></div><div></div><div style="margin-top: 40px;"><button type="button" aria-label="resize dimentions" class="ptro-named-btn ptro-resize ptro-color-control">${Ct("resizeResize")}</button><button type="button" aria-label="resize scale" class="ptro-named-btn ptro-scale ptro-color-control">${Ct("resizeScale")}</button><button type="button" aria-label="cancel" class="ptro-named-btn ptro-close ptro-color-control">${Ct("cancel")}</button></div></div></div>`}}class Ar{constructor(n){this.main=n;let i={extend_top:{internalName:"extend_top",handle:l=>{this.tmpImg=l;let f=this.main.size.h,C=this.main.size.w,p=f+l.naturalHeight,w=Math.max(C,l.naturalWidth),W=this.ctx.getImageData(0,0,this.main.size.w,this.main.size.h);if(this.main.resize(w,p),this.main.clearBackground(),this.ctx.putImageData(W,0,l.naturalHeight),this.main.adjustSizeFull(),l.naturalWidth<C){let ot=Math.round((C-l.naturalWidth)/2);this.main.select.placeAt(ot,0,ot,f,l)}else this.main.select.placeAt(0,0,0,f,l);this.worklog.captureState()}},extend_left:{internalName:"extend_left",handle:l=>{this.tmpImg=l;let f=this.main.size.h,C=this.main.size.w,p=C+l.naturalWidth,w=Math.max(f,l.naturalHeight),W=this.ctx.getImageData(0,0,this.main.size.w,this.main.size.h);if(this.main.resize(p,w),this.main.clearBackground(),this.ctx.putImageData(W,l.naturalWidth,0),this.main.adjustSizeFull(),l.naturalHeight<f){let ot=Math.round((f-l.naturalHeight)/2);this.main.select.placeAt(0,ot,C,ot,l)}else this.main.select.placeAt(0,0,C,0,l);this.worklog.captureState()}},extend_right:{internalName:"extend_right",handle:l=>{this.tmpImg=l;let f=this.main.size.h,C=this.main.size.w,p=C+l.naturalWidth,w=Math.max(f,l.naturalHeight),W=this.ctx.getImageData(0,0,this.main.size.w,this.main.size.h);if(this.main.resize(p,w),this.main.clearBackground(),this.ctx.putImageData(W,0,0),this.main.adjustSizeFull(),l.naturalHeight<f){let ot=Math.round((f-l.naturalHeight)/2);this.main.select.placeAt(C,ot,0,ot,l)}else this.main.select.placeAt(C,0,0,0,l);this.worklog.captureState()}},extend_down:{internalName:"extend_down",handle:l=>{this.tmpImg=l;let f=this.main.size.h,C=this.main.size.w,p=f+l.naturalHeight,w=Math.max(C,l.naturalWidth),W=this.ctx.getImageData(0,0,this.main.size.w,this.main.size.h);if(this.main.resize(w,p),this.main.clearBackground(),this.ctx.putImageData(W,0,0),this.main.adjustSizeFull(),l.naturalWidth<C){let ot=Math.round((C-l.naturalWidth)/2);this.main.select.placeAt(ot,f,ot,0,l)}else this.main.select.placeAt(0,f,0,0,l);this.worklog.captureState()}}},c={replace_all:{internalName:"fit",handle:l=>{this.main.params.backplateImgUrl&&(this.main.params.backplateImgUrl=void 0,this.main.tabelCell.style.background="",this.main.canvas.style.backgroundColor=`${this.main.params.backgroundFillColor}ff`,this.pasteOptions=Object.assign({},c,i),this.activeOption=this.pasteOptions,this.main.wrapper.querySelector(".ptro-paster-select-wrapper").remove(),this.main.wrapper.insertAdjacentHTML("beforeend",this.html()),this.init(n)),this.main.fitImage(l,this.mimetype)}},paste_over:{internalName:"over",handle:l=>{this.tmpImg=l;let f=this.main.size.h,C=this.main.size.w;if(l.naturalHeight<=f&&l.naturalWidth<=C)this.main.select.placeAt(0,0,C-l.naturalWidth,f-l.naturalHeight,l);else if(l.naturalWidth/l.naturalHeight>C/f){let p=C*(l.naturalHeight/l.naturalWidth);this.main.select.placeAt(0,0,0,f-p,l)}else{let p=f*(l.naturalWidth/l.naturalHeight);this.main.select.placeAt(0,0,C-p,0,l)}this.worklog.captureState()}}};if(this.main.params.backplateImgUrl)return this.pasteOptions=Object.assign({},c),void(this.activeOption=this.pasteOptions);this.pasteOptions=Object.assign({},c,i),this.activeOption=this.pasteOptions}init(n){this.CLIP_DATA_MARKER="painterro-image-data",this.ctx=n.ctx,this.main=n,this.worklog=n.worklog,this.selector=n.wrapper.querySelector(".ptro-paster-select-wrapper"),this.cancelChoosing(),this.img=null,this.mimetype=null,this.getAvailableOptions().forEach((i=>{let c=this.pasteOptions[i];this.main.getElemByIdSafe(c.id).onclick=()=>{this.loading?this.doLater=c.handle:c.handle(this.img),this.cancelChoosing()}})),this.loading=!1,this.doLater=null}insert(n,i,c,l){this.main.ctx.drawImage(this.tmpImg,n,i,c,l),this.main.worklog.reCaptureState()}cancelChoosing(){this.selector.setAttribute("hidden",""),this.waitChoice=!1}loaded(n,i){this.img=n,this.mimetype=i,this.loading=!1,this.doLater&&(this.doLater(n),this.doLater=null)}getAvailableOptions(){return this.main.params.how_to_paste_actions?Object.keys(this.activeOption).filter((n=>this.main.params.how_to_paste_actions.includes(n))):Object.keys(this.activeOption)}handleOpen(n,i){this.startLoading();let c=l=>{let f=new Image,C=this.main.worklog.clean&&this.main.params.replaceAllOnEmptyBackground;if(f.onload=()=>{C?this.main.fitImage(f,i):this.loaded(f,i),this.finishLoading()},f.onerror=()=>{typeof this.main.params.onImageFailedOpen=="function"&&this.main.params.onImageFailedOpen()},f.src=l,!C){let p=this.getAvailableOptions();p.length!==1?(this.selector.removeAttribute("hidden"),this.waitChoice=!0):this.doLater=this.activeOption[p[0]].handle}};n.indexOf("data")!==0?(function(l,f,C){let p=new XMLHttpRequest;p.onload=()=>{let w=new FileReader;w.onloadend=()=>{f(w.result)},w.readAsDataURL(p.response)},p.onerror=()=>{typeof C=="function"&&C()},p.open("GET",l),p.responseType="blob",p.send()})(n,(l=>{c(l)}),(()=>{typeof this.main.params.onImageFailedOpen=="function"&&this.main.params.onImageFailedOpen()})):c(n)}handleKeyDown(n){return this.waitChoice&&n.keyCode===mt.esc?(this.cancelChoosing(),!0):!(!this.waitChoice||event.keyCode!==mt.enter)}startLoading(){if(this.loading=!0,this.main.toolByName.open.buttonId){let n=this.main.getElemByIdSafe(this.main.toolByName.open.buttonId);n&&n.setAttribute("disabled","true");let i=this.main.doc.querySelector(`#${this.main.toolByName.open.buttonId} > i`);i&&(i.className="ptro-icon ptro-icon-loading ptro-spinning")}}finishLoading(){if(this.main.toolByName.open.buttonId){let n=this.main.getElemByIdSafe(this.main.toolByName.open.buttonId);n&&n.removeAttribute("disabled");let i=this.main.doc.querySelector(`#${this.main.toolByName.open.buttonId} > i`);i&&(i.className="ptro-icon ptro-icon-open")}this.main.params.onImageLoaded&&this.main.params.onImageLoaded()}static get(n){return n.inserter||(n.inserter=new Ar(n)),n.inserter}static controlObjToString(n,i=""){return n.id=$t(),`<button type="button" id="${n.id}" class="ptro-selector-btn ptro-color-control ${i}"><div><i class="ptro-icon ptro-icon-paste_${n.internalName}"></i></div><div>${Ct(`pasteOptions.${n.internalName}`)}</div></button>`}html(){let n=this.main.params.backplateImgUrl,i="",c="";return this.getAvailableOptions().forEach((l=>{l==="replace_all"||l==="paste_over"?i+=`<div class="ptro-paster-fit">
          ${Ar.controlObjToString(this.pasteOptions[l],"ptro-selector-fit")}
        <div class="ptro-paster-wrapper-label">
          ${Ct(`pasteOptions.${this.pasteOptions[l].internalName}`)}
        </div></div>`:c+=Ar.controlObjToString(this.pasteOptions[l],"ptro-selector-extend")})),`<div class="ptro-paster-select-wrapper" hidden><div class="ptro-paster-select ptro-v-middle"><div class="ptro-in ptro-v-middle-in"> <div class="ptro-paster-wrappers-fits">
        ${i}
        ${n||!c?"":`
          <div class="ptro-paster-select-wrapper-extends">
            <div class="ptro-paster-extends-items">
              ${c}
            </div>
            <div class="ptro-paster-wrapper-label">${Ct("pasteOptions.extend")}</div>
          </div>`}
        </div>
      </div></div></div>`}}class dn{constructor(n){this.main=n,this.wrapper=n.wrapper.querySelector(".ptro-settings-widget-wrapper"),this.inputPixelSize=n.wrapper.querySelector(".ptro-settings-widget-wrapper .ptro-pixel-size-input"),this.applyButton=n.wrapper.querySelector(".ptro-settings-widget-wrapper button.ptro-apply"),this.closeButton=n.wrapper.querySelector(".ptro-settings-widget-wrapper button.ptro-close"),this.clearButton=n.wrapper.querySelector(".ptro-settings-widget-wrapper button.ptro-clear"),this.bgSelBtn=n.wrapper.querySelector(".ptro-settings-widget-wrapper .ptro-color-btn"),this.errorHolder=n.wrapper.querySelector(".ptro-settings-widget-wrapper .ptro-error"),this.clearButton.onclick=()=>{this.main.currentBackground=this.main.colorWidgetState.bg.alphaColor,this.main.currentBackgroundAlpha=this.main.colorWidgetState.bg.alpha,this.main.clearBackground(),this.startClose()},this.bgSelBtn.onclick=()=>{this.main.colorPicker.open(this.main.colorWidgetState.bg)},this.closeButton.onclick=()=>{this.startClose()},this.applyButton&&(this.applyButton.onclick=()=>{let i,c=Mt(this.inputPixelSize.value);if(c.slice(-1)==="%"){let l=Mt(c.slice(0,-1));i=/^\d+$/.test(l)&&parseInt(l,10)!==0,i&&(c=`${l}%`)}else i=/^\d+$/.test(c)&&parseInt(c,10)!==0;i?(this.main.select.pixelizePixelSize=c,Dt("pixelizePixelSize",c),this.startClose(),this.errorHolder.setAttribute("hidden","")):(this.errorHolder.innerText=Ct("wrongPixelSizeValue"),this.errorHolder.removeAttribute("hidden"))})}handleKeyDown(n){return n.keyCode===mt.enter||n.keyCode===mt.esc&&(this.startClose(),!0)}open(){this.wrapper.removeAttribute("hidden"),this.opened=!0,this.inputPixelSize&&(this.inputPixelSize.value=this.main.select.pixelizePixelSize),this.bgSelBtn.style["background-color"]=this.main.colorWidgetState.bg.alphaColor}close(){this.wrapper.setAttribute("hidden","true"),this.opened=!1}startClose(){this.errorHolder.setAttribute("hidden",""),this.main.closeActiveTool()}static html(n){return`<div class="ptro-settings-widget-wrapper ptro-common-widget-wrapper ptro-v-middle" hidden><div class="ptro-settings-widget ptro-color-main ptro-v-middle-in"><table style="margin-top: 5px"><tr><td class="ptro-label ptro-resize-table-left" style="height:30px;">${Ct("backgroundColor")}</td><td class="ptro-strict-cell"><button type="button" aria-label="background" data-id="bg" class="ptro-color-btn ptro-bordered-btn ptro-color-control" style="margin-top: -12px;"></button><span class="ptro-btn-color-checkers"></span></td><td><button type="button" aria-label="fill page width" style="margin-top: -2px;" class="ptro-named-btn ptro-clear ptro-color-control" title="${Ct("fillPageWith")}">${Ct("clear")}</button></td></tr>`+(n.params.pixelizeHideUserInput?"":`<tr><td class="ptro-label ptro-resize-table-left" >${Ct("pixelizePixelSize")}</td><td colspan="2"><input class="ptro-input ptro-pixel-size-input" pattern="[0-9]{1,}%?" type="text" /></td></tr>`)+'</table><div class="ptro-error" hidden></div><div style="margin-top: 20px">'+(n.params.pixelizeHideUserInput?`<button type="button" aria-label="close" class="ptro-named-btn ptro-close ptro-color-control">${Ct("close")}</button>`:`<button type="button" aria-label="apply" class="ptro-named-btn ptro-apply ptro-color-control">${Ct("apply")}</button><button type="button" aria-label="cancel" class="ptro-named-btn ptro-close ptro-color-control">${Ct("cancel")}</button>`)+"</div></div></div>"}}class ie{constructor(n){this.main=n}buildFontSizeControl(n){let i=()=>{let l=this.main.getElemByIdSafe(this.main.activeTool.controls[n].id).value;this.main.textTool.setFontSize(l),Dt("defaultFontSize",l)},c=()=>this.main.textTool.fontSize;return this.main.params.availableFontSizes?ie.buildDropDownControl("fontSize",i,c,this.main.params.availableFontSizes):ie.buildInputControl("fontSize",i,c,1,200)}buildEraserWidthControl(n){let i=()=>{let l=this.main.getElemByIdSafe(this.main.activeTool.controls[n].id).value;this.main.primitiveTool.setEraserWidth(l),Dt("defaultEraserWidth",l)},c=()=>this.main.primitiveTool.eraserWidth;return this.main.params.availableEraserWidths?ie.buildDropDownControl("eraserWidth",i,c,this.main.params.availableEraserWidths):ie.buildInputControl("eraserWidth",i,c,1,99)}buildLineWidthControl(n){let i=()=>{let l=this.main.getElemByIdSafe(this.main.activeTool.controls[n].id).value;this.main.primitiveTool.setLineWidth(l),Dt("defaultLineWidth",l)},c=()=>this.main.primitiveTool.lineWidth;return this.main.params.availableLineWidths?ie.buildDropDownControl("lineWidth",i,c,this.main.params.availableLineWidths):ie.buildInputControl("lineWidth",i,c,0,99)}buildShadowOnControl(n){return{type:"bool",title:"shadowOn",titleFull:"shadowOnFull",target:"shadowOn",action:()=>{let i=this.main.getElemByIdSafe(this.main.activeTool.controls[n].id),c=i.getAttribute("data-value")!=="true";this.main.primitiveTool.setShadowOn(c),i.setAttribute("data-value",c?"true":"false"),Dt("defaultPrimitiveShadowOn",c)},getValue:()=>this.main.primitiveTool.shadowOn}}buildPaintBucketControl(n){return ie.buildInputControl("lineWidth",(()=>{let i=document.getElementById(this.main.activeTool.controls[n].id).value;console.log("buildPaintBucketControl width: "+i),Dt("activeFillColor",i)}),(()=>this.main.primitiveTool.lineWidth),1,99)}buildArrowLengthControl(n){let i=()=>{let l=this.main.getElemByIdSafe(this.main.activeTool.controls[n].id).value;this.main.primitiveTool.setArrowLength(l),Dt("defaultArrowLength",l)},c=()=>this.main.primitiveTool.arrowLength;return this.main.params.availableArrowLengths?ie.buildDropDownControl("arrowLength",i,c,this.main.params.availableArrowLengths):ie.buildInputControl("arrowLength",i,c,1,99)}static buildInputControl(n,i,c,l,f){return{type:"int",title:n,titleFull:`${n}Full`,target:n,min:l,max:f,action:i,getValue:c}}static buildDropDownControl(n,i,c,l){return{type:"dropdown",title:n,titleFull:`${n}Full`,target:n,action:i,getValue:c,getAvailableValues:()=>l.map((f=>({value:f,name:f.toString(),title:f.toString()})))}}}class ui{constructor(n){this.main=n,this.canvasWidth=600,this.canvasHeight=420,this.el=this.main.toolContainer,this.input=this.el.querySelector(".ptro-text-tool-input")}init(){this.ctx=this.main.ctx,this.canvas=this.main.canvas,this.colorLayerData=this.ctx.getImageData(0,0,this.canvasWidth,this.canvasHeight),this.drawingAreaX=0,this.drawingAreaY=0,this.canvasWidth=this.canvas.width,this.canvasHeight=this.canvas.height,this.drawingAreaWidth=this.canvasWidth,this.drawingAreaHeight=this.canvasHeight}handleMouseDown(n){let i=n.target.classList[0],c=this.main.getScale();if(i==="ptro-crp-el"){this.init(),this.colorLayerData=this.ctx.getImageData(0,0,this.canvasWidth,this.canvasHeight),this.active||(this.input.innerHTML="<br>",this.pendingClear=!0),this.active=!0;let l=[n.clientX-this.main.elLeft()+this.main.scroller.scrollLeft,n.clientY-this.main.elTop()+this.main.scroller.scrollTop],f={x:l[0]*c,y:l[1]*c};this.paintAt(f.x,f.y)}}paintAt(n,i){n=(n=Math.round(n))>0?n:0,i=(i=Math.round(i-1))>0?i:0,this.getClickedOnColor(n,i);var c=4*(i*this.canvasWidth+n),l=this.getPixelColor(this.colorLayerData,c),f=l.r,C=l.g,p=l.b;l.a;let w=sr(this.main.colorWidgetState.fill.palleteColor);this.color=this.main.colorWidgetState.fill.palleteColor,f===w.r&&C===w.g&&p===w.b||(this.floodFill(n,i,f,C,p),this.ctx.putImageData(this.colorLayerData,0,0),this.main.worklog.captureState())}matchStartColor(n){var i=this.getPixelColor(this.colorLayerData,n);return this.matchClickedColor(i.r,i.g,i.b,i.a)}matchClickedColor(n,i,c,l){let f=this.main.params.bucketSensivity;var C=Math.abs(n-this.clickedOnColor.r)<f,p=Math.abs(i-this.clickedOnColor.g)<f,w=Math.abs(c-this.clickedOnColor.b)<f,W=Math.abs(l-this.clickedOnColor.a)<f;return C&&p&&w&&W}getClickedOnColor(n,i){var c=4*(i*this.canvasWidth+n),l=this.getPixelColor(this.colorLayerData,c);this.clickedOnColor={r:l.r,g:l.g,b:l.b,a:l.a}}floodFill(n,i,c,l,f){for(var C,p,w,W,ot,zt,Bt=this.drawingAreaX,Ut=this.drawingAreaY,Tt=this.drawingAreaX+this.drawingAreaWidth-1,Vt=this.drawingAreaY+this.drawingAreaHeight-1,Yt=[[n,i]];Yt.length;){p=(C=Yt.pop())[0],W=4*((w=C[1])*this.canvasWidth+p);let Ie=sr(this.color);for(;w>=Ut&&this.matchStartColor(W);)w-=1,W-=4*this.canvasWidth;for(W+=4*this.canvasWidth,w+=1,ot=!1,zt=!1;w<=Vt&&this.matchStartColor(W);)w+=1,this.colorPixel(W,Ie.r,Ie.g,Ie.b),p>Bt&&(this.matchStartColor(W-4)?ot||(Yt.push([p-1,w]),ot=!0):ot&&(ot=!1)),p<Tt&&(this.matchStartColor(W+4)?zt||(Yt.push([p+1,w]),zt=!0):zt&&(zt=!1)),W+=4*this.canvasWidth}}colorPixel(n,i,c,l,f){this.colorLayerData.data[n]=i,this.colorLayerData.data[n+1]=c,this.colorLayerData.data[n+2]=l,this.colorLayerData.data[n+3]=f!==void 0?f:255}getPixelColor(n,i){return{r:n.data[i],g:n.data[i+1],b:n.data[i+2],a:n.data[i+3]}}}S(486);class fn{constructor(n){this.main=n,this.wrapper=n.wrapper.querySelector(".ptro-filters-widget-wrapper"),this.input=n.wrapper.querySelector(".ptro-filters-widget-wrapper .ptro-filters-input"),this.applyButton=n.wrapper.querySelector(".ptro-filters-widget-wrapper button.ptro-apply"),this.closeButton=n.wrapper.querySelector(".ptro-filters-widget-wrapper button.ptro-close"),this.errorHolder=n.wrapper.querySelector(".ptro-filters-widget-wrapper .ptro-error"),this.filters=["grayscale","sepia","invert","brightness","contrast","saturate"],this.chosenFilter=this.filters[0],this.initCtxImageData=null,this.filterValue=0,this.filtersForApply=this.createFiltersForApply()}createFiltersForApply(){let n={};return this.filters.forEach((i=>{n[i]=0})),n}createFilterString(){let n="";for(let i in this.filtersForApply)this.filtersForApply[i]!==0&&(n+=`${i}(${this.filtersForApply[i]}%) `);return n}getFilters(){return this.filters.map((n=>({value:n,name:n,title:n})))}setFilter(n){this.chosenFilter=n,this.filtersForApply.hasOwnProperty(n)&&(this.filtersForApply[n]=this.filterValue)}setPercents(n){this.filterValue=n,this.filtersForApply.hasOwnProperty(this.chosenFilter)&&(this.filtersForApply[this.chosenFilter]=n)}getFilter(){return this.filters[0]}applyFilter(){let n=this.main.size.w,i=this.main.size.h,c=this.initCtxImageData,l=this.main.doc.createElement("canvas");l.width=n,l.height=i,l.getContext("2d").putImageData(c,0,0),this.main.ctx.save(),this.main.ctx.filter=this.createFilterString(),this.main.ctx.drawImage(l,0,0),this.main.worklog.captureState()}saveInitImg(){this.initCtxImageData=this.main.ctx.getImageData(0,0,this.main.size.w,this.main.size.h),this.createFiltersForApply()}open(){this.wrapper.removeAttribute("hidden"),this.opened=!0}close(){this.wrapper.setAttribute("hidden",""),this.opened=!1}startClose(){this.errorHolder.setAttribute("hidden",""),this.main.closeActiveTool()}getValue(){}static html(n){return'<div class="ptro-filters-widget-wrapper ptro-common-widget-wrapper ptro-v-middle" hidden>   <div class="ptro-filters-widget-content ptro-common-widget-content">       <div class="ptro-filters-widget-title">'+Ct("filters")+'</div>       <div class="ptro-filters-widget-input-wrapper">           <div class="ptro-error ptro-error-hidden">'+Ct("wrongFilterValue")+'</div>       </div>       <div class="ptro-filters-widget-buttons">           <button type="button" class="ptro-apply ptro-color-control">'+Ct("apply")+'</button>           <button type="button" class="ptro-close ptro-color-control">'+Ct("close")+"</button>       </div>   </div></div>"}}class di{constructor(n){this.element=n}createEvent(n,i){return new CustomEvent(n,{detail:i})}dispatchEvent(n,i){this.element.dispatchEvent(this.createEvent(n,i))}addEventListener(n,i){this.element.addEventListener(n,i)}removeEventListener(n,i){this.element.removeEventListener(n,i)}useCustomEvent(n,i){this.dispatchEvent(n,i)}}class fi{constructor(n){let i=document.querySelector(`#${n.id}`)||document.getElementById("app");this.customEvents=new di(i),"documentOffsetTop"in Element.prototype||Object.defineProperty(Element.prototype,"documentOffsetTop",{get(){return this.getBoundingClientRect().top}}),"documentOffsetLeft"in Element.prototype||Object.defineProperty(Element.prototype,"documentOffsetLeft",{get(){return this.getBoundingClientRect().left}}),"documentClientWidth"in Element.prototype||Object.defineProperty(Element.prototype,"documentClientWidth",{get(){let p=this.getBoundingClientRect();return p.width?p.width:p.right-p.left}}),"documentClientHeight"in Element.prototype||Object.defineProperty(Element.prototype,"documentClientHeight",{get(){let p=this.getBoundingClientRect();return p.height?p.height:p.bottom-p.top}}),this.getElemByIdSafe=p=>{if(!p)throw new Error(`Can't get element with id=${p}, please create an issue here, we will easily fx it: https://github.com/devforth/painterro/issues/`);return document.getElementById(p)},this.tools=[{name:"select",hotkey:"s",activate:()=>{this.initText&&this.wrapper.click(),this.toolContainer.style.cursor="crosshair",this.select.activate(),this.select.draw()},close:()=>{this.select.close(),this.toolContainer.style.cursor="auto"},eventListner:()=>this.select},{name:"crop",hotkey:"c",activate:()=>{this.initText&&this.wrapper.click(),this.select.doCrop(),this.closeActiveTool()}},{name:"pixelize",hotkey:"p",activate:()=>{this.initText&&this.wrapper.click(),this.select.doPixelize(),this.closeActiveTool()}},{name:"line",hotkey:"l",controls:[()=>({type:"color",title:"lineColor",target:"line",titleFull:"lineColorFull",action:()=>{this.colorPicker.open(this.colorWidgetState.line)}}),()=>this.controlBuilder.buildLineWidthControl(1),()=>this.controlBuilder.buildShadowOnControl(2)],activate:()=>{this.initText&&this.wrapper.click(),this.toolContainer.style.cursor="crosshair",this.primitiveTool.activate("line")},eventListner:()=>this.primitiveTool},{name:"arrow",hotkey:"a",controls:[()=>({type:"color",title:"lineColor",target:"line",titleFull:"lineColorFull",action:()=>{this.colorPicker.open(this.colorWidgetState.line)}}),()=>this.controlBuilder.buildArrowLengthControl(1),()=>this.controlBuilder.buildShadowOnControl(2)],activate:()=>{this.initText&&this.wrapper.click(),this.toolContainer.style.cursor="crosshair",this.primitiveTool.activate("arrow")},eventListner:()=>this.primitiveTool},{name:"rect",controls:[()=>({type:"color",title:"lineColor",titleFull:"lineColorFull",target:"line",action:()=>{this.colorPicker.open(this.colorWidgetState.line)}}),()=>({type:"color",title:"fillColor",titleFull:"fillColorFull",target:"fill",action:()=>{this.colorPicker.open(this.colorWidgetState.fill)}}),()=>this.controlBuilder.buildLineWidthControl(2),()=>this.controlBuilder.buildShadowOnControl(3)],activate:()=>{this.initText&&this.wrapper.click(),this.toolContainer.style.cursor="crosshair",this.primitiveTool.activate("rect")},eventListner:()=>this.primitiveTool},{name:"filters",controls:[()=>({type:"dropdown",title:"filters",titleFull:"imageFilters",action:()=>{let p=this.activeTool.controls[0].id,w=this.getElemByIdSafe(p).value;this.filters.setFilter(w)},getValue:()=>this.filters.getFilter(),getAvailableValues:()=>this.filters.getFilters()}),()=>({type:"int",title:"percents",titleFull:"percentsFull",min:0,max:100,options:{eventOnChange:!0},action:()=>{let p=this.getElemByIdSafe(this.activeTool.controls[1].id).value;this.filters.setPercents(p),this.filters.applyFilter()},getValue:()=>1})],activate:()=>{this.initText&&this.wrapper.click(),this.filters.saveInitImg(),this.toolContainer.style.cursor="crosshair"}},{name:"ellipse",controls:[()=>({type:"color",title:"lineColor",titleFull:"lineColorFull",target:"line",action:()=>{this.colorPicker.open(this.colorWidgetState.line)}}),()=>({type:"color",title:"fillColor",titleFull:"fillColorFull",target:"fill",action:()=>{this.colorPicker.open(this.colorWidgetState.fill)}}),()=>this.controlBuilder.buildLineWidthControl(2),()=>this.controlBuilder.buildShadowOnControl(3)],activate:()=>{this.initText&&this.wrapper.click(),this.toolContainer.style.cursor="crosshair",this.primitiveTool.activate("ellipse")},eventListner:()=>this.primitiveTool},{name:"brush",hotkey:"b",controls:[()=>({type:"color",title:"lineColor",target:"line",titleFull:"lineColorFull",action:()=>{this.colorPicker.open(this.colorWidgetState.line)}}),()=>this.controlBuilder.buildLineWidthControl(1)],activate:()=>{this.initText&&this.wrapper.click(),this.toolContainer.style.cursor="crosshair",this.primitiveTool.activate("brush")},eventListner:()=>this.primitiveTool},{name:"eraser",controls:[()=>this.controlBuilder.buildEraserWidthControl(0)],activate:()=>{this.initText&&this.wrapper.click(),this.toolContainer.style.cursor="crosshair",this.primitiveTool.activate("eraser")},eventListner:()=>this.primitiveTool},{name:"text",hotkey:"t",controls:[()=>({type:"color",title:"textColor",titleFull:"textColorFull",target:"line",action:()=>{this.colorPicker.open(this.colorWidgetState.line,(p=>{this.textTool.setFontColor(p.alphaColor)}))}}),()=>this.controlBuilder.buildFontSizeControl(1),()=>({type:"dropdown",title:"fontName",titleFull:"fontNameFull",target:"fontName",action:()=>{let p=this.getElemByIdSafe(this.activeTool.controls[2].id).value;this.textTool.setFont(p)},getValue:()=>this.textTool.getFont(),getAvailableValues:()=>this.textTool.getFonts()}),()=>({type:"bool",title:"fontIsBold",titleFull:"fontIsBoldFull",target:"fontIsBold",action:()=>{let p=this.getElemByIdSafe(this.activeTool.controls[3].id),w=p.getAttribute("data-value")!=="true";this.textTool.setFontIsBold(w),Dt("defaultFontBold",w),p.setAttribute("data-value",w?"true":"false")},getValue:()=>this.textTool.isBold}),()=>({type:"bool",title:"fontIsItalic",titleFull:"fontIsItalicFull",target:"fontIsItalic",action:()=>{let p=this.getElemByIdSafe(this.activeTool.controls[4].id),w=p.getAttribute("data-value")!=="true";this.textTool.setFontIsItalic(w),Dt("defaultFontItalic",w),p.setAttribute("data-value",w?"true":"false")},getValue:()=>this.textTool.isItalic}),()=>({type:"bool",title:"fontStrokeAndShadow",titleFull:"fontStrokeAndShadowFull",target:"fontStrokeAndShadow",action:()=>{let p=this.getElemByIdSafe(this.activeTool.controls[5].id),w=p.getAttribute("data-value")!=="true";this.textTool.setStrokeOn(w),Dt("defaultTextStrokeAndShadow",w),p.setAttribute("data-value",w?"true":"false")},getValue:()=>this.textTool.strokeOn})],activate:()=>{this.initText&&this.wrapper.click(),this.textTool.setFontColor(this.colorWidgetState.line.alphaColor),this.toolContainer.style.cursor="crosshair"},close:()=>{this.textTool.close()},eventListner:()=>this.textTool},{name:"rotate",hotkey:"r",activate:()=>{this.initText&&this.wrapper.click();let p=this.size.w,w=this.size.h,W=this.ctx.getImageData(0,0,this.size.w,this.size.h),ot=this.doc.createElement("canvas");ot.width=p,ot.height=w,ot.getContext("2d").putImageData(W,0,0),this.resize(w,p),this.ctx.save(),this.ctx.translate(w/2,p/2),this.ctx.rotate(90*Math.PI/180),this.ctx.drawImage(ot,-p/2,-w/2),this.adjustSizeFull(),this.ctx.restore(),this.worklog.captureState(),this.closeActiveTool()}},{name:"resize",activate:()=>{this.initText&&this.wrapper.click(),this.resizer.open()},close:()=>{this.resizer.close()},eventListner:()=>this.resizer},{name:"undo",activate:()=>{this.initText&&this.wrapper.click(),this.worklog.undoState()},eventListner:()=>this.resizer},{name:"redo",activate:()=>{this.initText&&this.wrapper.click(),this.worklog.redoState()},eventListner:()=>this.resizer},{name:"settings",activate:()=>{this.initText&&this.wrapper.click(),this.settings.open()},close:()=>{this.settings.close()},eventListner:()=>this.settings},{name:"zoomout",activate:()=>{this.initText&&this.wrapper.click(),this.zoomButtonActive=!0;let p=this.canvas.getBoundingClientRect(),w={wheelDelta:-120,clientX:p.right/2,clientY:p.bottom/2};this.curCord=[w.clientX-this.elLeft()+this.scroller.scrollLeft,w.clientY-this.elTop()+this.scroller.scrollTop];let W=this.getScale();this.curCord=[this.curCord[0]*W,this.curCord[1]*W],this.zoomImage(w)}},{name:"zoomin",activate:()=>{this.initText&&this.wrapper.click(),this.zoomButtonActive=!0;let p=this.canvas.getBoundingClientRect(),w={wheelDelta:120,clientX:p.right/2,clientY:p.bottom/2};this.curCord=[w.clientX-this.elLeft()+this.scroller.scrollLeft,w.clientY-this.elTop()+this.scroller.scrollTop];let W=this.getScale();this.curCord=[this.curCord[0]*W,this.curCord[1]*W],this.zoomImage(w)}},{name:"bucket",hotkey:"f",controls:[()=>({type:"color",title:"fillColor",target:"fill",titleFull:"fillColorFull",action:()=>{this.colorPicker.open(this.colorWidgetState.fill)}})],activate:()=>{this.toolContainer.style.cursor="crosshair",this.primitiveTool.activate("bucket")},eventListner:()=>this.paintBucket},{name:"clear",activate:()=>{this.clear(),this.closeActiveTool()}},{name:"save",right:!0,hotkey:()=>!!this.params.saveByEnter&&"enter",activate:()=>{this.initText&&this.wrapper.click(),this.save(),this.closeActiveTool()}},{name:"open",right:!0,activate:()=>{this.initText&&this.wrapper.click(),this.closeActiveTool();let p=this.getElemByIdSafe(this.fileInputId);p.onchange=w=>{let W=w.target.files||w.dataTransfer.files;W.length&&(this.openFile(W[0]),p.value="")},p.click()}},{name:"close",hotkey:()=>!!this.params.hideByEsc&&"esc",right:!0,activate:()=>{this.initText&&this.wrapper.click();let p=()=>{this.closeActiveTool(),this.close(),this.hide()};this.params.onBeforeClose?this.params.onBeforeClose(this.hasUnsaved,p):p()}},...n.customTools?.map((p=>({name:p.name,activate:p.callBack,iconUrl:p.iconUrl})))||[]],this.params=hn(n,this.tools.map((p=>p.name))),this.colorWidgetState={line:{target:"line",palleteColor:this.params.activeColor,alpha:this.params.activeColorAlpha,alphaColor:this.params.activeAlphaColor},fill:{target:"fill",palleteColor:this.params.activeFillColor,alpha:this.params.activeFillColorAlpha,alphaColor:this.params.activeFillAlphaColor},bg:{target:"bg",palleteColor:this.params.backgroundFillColor,alpha:this.params.backgroundFillColorAlpha,alphaColor:this.params.backgroundFillAlphaColor}},this.currentBackground=this.colorWidgetState.bg.alphaColor,this.currentBackgroundAlpha=this.colorWidgetState.bg.alpha,this.controlBuilder=new ie(this),this.isMobile=z.any,this.toolByName={},this.toolByKeyCode={},this.tools.forEach((p=>{if(p.controls&&(p.controls=p.controls.map((w=>w()))),this.toolByName[p.name]=p,p.hotkey instanceof Function&&(p.hotkey=p.hotkey()),p.hotkey&&!this.params.hiddenTools.includes(p.name)){if(!mt[p.hotkey])throw new Error(`Key code for ${p.hotkey} not defined in KEYS`);this.toolByKeyCode[mt[p.hotkey]]=p}})),this.activeTool=void 0,this.zoom=!1,this.ratioRelation=void 0,this.id=this.params.id,this.saving=!1,this.id===void 0?(this.id=$t(),this.holderId=$t(),this.holderEl=document.createElement("div"),this.holderEl.id=this.holderId,this.holderEl.className="ptro-holder-wrapper",document.body.appendChild(this.holderEl),this.holderEl.innerHTML=`<div id='${this.id}' class="ptro-holder"></div>`,this.baseEl=this.getElemByIdSafe(this.id)):(this.baseEl=this.getElemByIdSafe(this.id),this.holderEl=null);let c="",l="";this.tools.filter((p=>!this.params.hiddenTools.includes(p.name))).forEach((p=>{let w=$t();p.buttonId=w;let W=p.hotkey?` [${p.hotkey.toUpperCase()}]`:"",ot=p.iconUrl?`<button type="button" aria-label=${p.name} class="ptro-icon-btn ptro-color-control" title="${p.name}" id="${w}" ><img width="14" src="${p.iconUrl}" alt="${p.name}" /></button>`:`<button type="button" aria-label=${p.name} class="ptro-icon-btn ptro-color-control" title="${Ct(`tools.${p.name}`)}${W}" id="${w}" ><i class="ptro-icon ptro-icon-${p.name}"></i></button>`;p.right?l+=ot:c+=ot})),this.inserter=Ar.get(this);let f=`<div class="ptro-crp-el">${Ee.code()}${un.code()}</div>`;this.loadedName="",this.doc=document,this.wrapper=this.doc.createElement("div"),this.wrapper.id=`${this.id}-wrapper`,this.wrapper.className="ptro-wrapper",this.wrapper.innerHTML=`<div class="ptro-scroller"><div class="ptro-center-table"><div class="ptro-center-tablecell"><canvas id="${this.id}-canvas"></canvas><div class="ptro-substrate"></div>${f}</div></div></div>${An.html()+pn.html()+Ye.html()+dn.html(this)+fn.html(this)+this.inserter.html()}`,this.baseEl.appendChild(this.wrapper),this.scroller=this.doc.querySelector(`#${this.id}-wrapper .ptro-scroller`),this.bar=this.doc.createElement("div"),this.bar.id=`${this.id}-bar`,this.bar.className="ptro-bar ptro-color-main",this.fileInputId=$t(),this.bar.innerHTML=`<div>${c}<span class="ptro-tool-controls"></span><span class="ptro-info"></span><span class="ptro-bar-right">${l}</span><input id="${this.fileInputId}" type="file" style="display: none" value="none" accept="image/x-png,image/png,image/gif,image/jpeg" /></div>`,this.isMobile&&(this.bar.style["overflow-x"]="auto"),this.baseEl.appendChild(this.bar);let C=this.doc.createElement("style");if(C.type="text/css",C.innerHTML=this.params.styles,this.baseEl.appendChild(C),this.saveBtn=this.baseEl.querySelector(`#${this.toolByName.save.buttonId}`),this.toolByName.save.buttonId&&this.saveBtn&&this.saveBtn.setAttribute("disabled","true"),this.body=this.doc.body,this.info=this.doc.querySelector(`#${this.id}-bar .ptro-info`),this.canvas=this.doc.querySelector(`#${this.id}-canvas`),this.ctx=this.canvas.getContext("2d"),this.toolControls=this.doc.querySelector(`#${this.id}-bar .ptro-tool-controls`),this.toolContainer=this.doc.querySelector(`#${this.id}-wrapper .ptro-crp-el`),this.substrate=this.doc.querySelector(`#${this.id}-wrapper .ptro-substrate`),this.zoomHelper=new pn(this),this.zoomButtonActive=!1,this.select=new Ee(this,(p=>{[this.toolByName.crop,this.toolByName.pixelize].forEach((w=>{this.setToolEnabled(w,p)}))})),this.params.backplateImgUrl){this.tabelCell=this.canvas.parentElement,this.tabelCell.style.backgroundImage=`url(${this.params.backplateImgUrl})`,this.tabelCell.style.backgroundRepeat="no-repeat",this.tabelCell.style.backgroundPosition="center center";let p=new Image;p.onload=()=>{this.resize(p.naturalWidth,p.naturalHeight),this.adjustSizeFull(),this.worklog.captureState(),this.tabelCell.style.backgroundSize=`${window.getComputedStyle(this.substrate).width} ${window.getComputedStyle(this.substrate).height}`},p.src=this.params.backplateImgUrl}this.resizer=new Ye(this),this.settings=new dn(this),this.primitiveTool=new lr(this),this.primitiveTool.setShadowOn(this.params.defaultPrimitiveShadowOn),this.primitiveTool.setLineWidth(this.params.defaultLineWidth),this.primitiveTool.setArrowLength(this.params.defaultArrowLength),this.primitiveTool.setEraserWidth(this.params.defaultEraserWidth),this.primitiveTool.setPixelSize(this.params.defaultPixelSize),this.hasUnsaved=!1,this.worklog=new Fe(this,(p=>{this.saveBtn&&!p.initial&&(this.saveBtn.removeAttribute("disabled"),this.hasUnsaved=!0),this.setToolEnabled(this.toolByName.undo,!p.first),this.setToolEnabled(this.toolByName.redo,!p.last),this.params.onChange&&this.params.onChange.call(this,{image:this.imageSaver,operationsDone:this.worklog.current.prevCount,realesedMemoryOperations:this.worklog.clearedCount})})),this.inserter.init(this),this.paintBucket=new ui(this),this.textTool=new un(this),this.filters=new fn(this),this.colorPicker=new An(this,(p=>{this.colorWidgetState[p.target]=p,this.doc.querySelector(`#${this.id} .ptro-color-btn[data-id='${p.target}']`).style["background-color"]=p.alphaColor;let w=sr(p.palleteColor);w!==void 0&&(p.palleteColor=br(w.r,w.g,w.b),p.target==="line"?(Dt("activeColor",p.palleteColor),Dt("activeColorAlpha",p.alpha)):p.target==="fill"?(Dt("activeFillColor",p.palleteColor),Dt("activeFillColorAlpha",p.alpha)):p.target==="bg"?(Dt("backgroundFillColor",p.palleteColor),Dt("backgroundFillColorAlpha",p.alpha)):p.target==="stroke"&&(Dt("textStrokeColor",p.palleteColor),Dt("textStrokeColorAlpha",p.alpha)))})),this.defaultTool=this.toolByName[this.params.defaultTool],this.tools.filter((p=>this.params.hiddenTools.indexOf(p.name)===-1)).forEach((p=>{this.getBtnEl(p).onclick=()=>{if(p===this.defaultTool&&this.activeTool===p)return;let w=this.activeTool;this.closeActiveTool(!0),w!==p?(this.setActiveTool(p),this.customEvents.dispatchEvent("changeActiveTool",p)):this.setActiveTool(this.defaultTool)},this.getBtnEl(p).ontouch=this.getBtnEl(p).onclick})),this.getBtnEl(this.defaultTool).click(),this.imageSaver={asDataURL:(p,w)=>{let W=p;return W===void 0&&(W=this.loadedImageType?this.loadedImageType:"image/png"),this.getAsUri(W,w)},asBlob:(p,w)=>{let W=p;W===void 0&&(W=this.loadedImageType?this.loadedImageType:"image/png");let ot=this.getAsUri(W,w),zt=atob(ot.split(",")[1]),Bt=new ArrayBuffer(zt.length),Ut=new Uint8Array(Bt);for(let Tt=0;Tt<zt.length;Tt+=1)Ut[Tt]=zt.charCodeAt(Tt);return new Blob([Bt],{type:W})},getOriginalMimeType:()=>this.loadedImageType,hasAlphaChannel:()=>{let p=this.ctx.getImageData(0,0,this.canvas.width,this.canvas.height).data;for(let w=3,W=p.length;w<W;w+=4)if(p[w]<255)return!0;return!1},suggestedFileName:p=>{let w=p;return w===void 0&&(w="png"),`${this.loadedName||`image-${$t()}`}.${w}`},getWidth:()=>this.size.w,getHeight:()=>this.size.h},this.initEventHandlers(),this.hide(),this.zoomFactor=1}setToolEnabled(n,i){if(n.buttonId){let c=this.getElemByIdSafe(n.buttonId);i?c.removeAttribute("disabled"):c.setAttribute("disabled","true")}}getAsUri(n,i){let c=i;return c===void 0&&(c=.92),this.canvas.toDataURL(n,c)}getBtnEl(n){return this.getElemByIdSafe(n.buttonId)}save(){if(this.saving)return this;this.saving=!0;let n=this.baseEl.querySelector(`#${this.toolByName.save.buttonId}`),i=this.baseEl.querySelector(`#${this.toolByName.save.buttonId} > i`);return this.toolByName.save.buttonId&&n&&n.setAttribute("disabled","true"),this.hasUnsaved=!1,i&&(i.className="ptro-icon ptro-icon-loading ptro-spinning"),this.params.saveHandler!==void 0?this.params.saveHandler(this.imageSaver,(c=>{c===!0&&this.hide(),i&&(i.className="ptro-icon ptro-icon-save"),this.saving=!1})):(fe("No saveHandler defined, please check documentation"),i&&(i.className="ptro-icon ptro-icon-save"),this.saving=!1),this}close(){this.params.onClose!==void 0&&this.params.onClose()}closeActiveTool(n){if(this.activeTool!==void 0){this.activeTool.close!==void 0&&this.activeTool.close(),this.toolControls.innerHTML="";let i=this.getBtnEl(this.activeTool);i&&(i.className=this.getBtnEl(this.activeTool).className.replace(" ptro-color-active-control","")),this.activeTool=void 0}n!==!0&&this.setActiveTool(this.defaultTool)}handleToolEvent(n,i){if(this.select.imagePlaced||this.select.area.activated)return this.select[n](i);if(this.activeTool&&this.activeTool.eventListner){let c=this.activeTool.eventListner();if(c[n])return c[n](i)}return!1}handleClipCopyEvent(n){let i=!1,c="image/png";if(n.keyCode===mt.c&&(n.ctrlKey||n.metaKey))if(this.inserter.waitChoice||this.select.imagePlaced||!this.select.shown)this.canvas.toBlob((l=>{navigator.clipboard.write([new ClipboardItem({[c]:l})])}),c,1),i=!0;else{let l=this.select.area,f=l.bottoml[0]-l.topl[0],C=l.bottoml[1]-l.topl[1],p=this.doc.createElement("canvas");p.width=f,p.height=C,p.getContext("2d").drawImage(this.canvas,-l.topl[0],-l.topl[1]),p.toBlob((w=>{navigator.clipboard.write([new ClipboardItem({[c]:w})])}),c,1),i=!0}return i}zoomImage({wheelDelta:n,clientX:i,clientY:c},l,f){let C=n;l!==void 0&&(C=l);let p=1;this.size.w>this.wrapper.documentClientWidth&&(p=Math.min(p,this.wrapper.documentClientWidth/this.size.w)),this.size.h>this.wrapper.documentClientHeight&&(p=Math.min(p,this.wrapper.documentClientHeight/this.size.h)),!this.zoom&&this.zoomFactor>p&&(this.zoomFactor=p);let w=.2;f!==void 0&&(w=f),this.zoomFactor+=Math.sign(C)*w,this.zoomFactor<p?(this.zoom=!1,this.zoomFactor=p):this.zoom=!0,this.adjustSizeFull(),this.select.adjustPosition(),this.zoom&&(this.scroller.scrollLeft=this.curCord[0]/this.getScale()-(i-this.wrapper.documentOffsetLeft),this.scroller.scrollTop=this.curCord[1]/this.getScale()-(c-this.wrapper.documentOffsetTop))}initEventHandlers(){this.documentHandlers={mousedown:n=>{this.shown&&(!this.worklog.empty||n.target.className.indexOf("ptro-crp-el")===-1&&n.target.className.indexOf("ptro-icon")===-1&&n.target.className.indexOf("ptro-named-btn")===-1||this.clearBackground(),this.colorPicker.handleMouseDown(n)!==!0&&this.handleToolEvent("handleMouseDown",n))},touchstart:n=>{if(n.touches.length===1)n.clientX=n.changedTouches[0].clientX,n.clientY=n.changedTouches[0].clientY,this.documentHandlers.mousedown(n);else if(n.touches.length===2){let i=ne({x:n.touches[0].clientX,y:n.touches[0].clientY},{x:n.touches[1].clientX,y:n.touches[1].clientY});this.lastFingerDist=i}},touchend:n=>{n.clientX=n.changedTouches[0].clientX,n.clientY=n.changedTouches[0].clientY,this.documentHandlers.mouseup(n)},touchmove:n=>{if(n.touches.length===1)n.clientX=n.touches[0].clientX,n.clientY=n.touches[0].clientY,this.documentHandlers.mousemove(n);else if(n.touches.length===2){let i=ne({x:n.touches[0].clientX,y:n.touches[0].clientY},{x:n.touches[1].clientX,y:n.touches[1].clientY}),c={x:(n.touches[0].clientX+n.touches[1].clientX)/2,y:(n.touches[0].clientY+n.touches[1].clientY)/2};n.clientX=c.x,n.clientY=c.y;let l=Math.abs(i-this.lastFingerDist),f=i>this.lastFingerDist?1:-1;this.documentHandlers.wheel(n,f,!0,.001*l),this.lastFingerDist=i,n.stopPropagation(),this.zoomButtonActive||n.preventDefault()}},mousemove:n=>{let i=n.target.classList[0]==="ptro-crp-el"||n.target.classList[0]==="ptro-bar";if(this.shown){this.handleToolEvent("handleMouseMove",n),this.colorPicker.handleMouseMove(n),this.zoomHelper.handleMouseMove(n),this.curCord=[n.clientX-this.elLeft()+this.scroller.scrollLeft,n.clientY-this.elTop()+this.scroller.scrollTop];let c=this.getScale();this.curCord=[this.curCord[0]*c,this.curCord[1]*c],n.target.tagName!==void 0&&n.target.tagName.toLowerCase()!=="input"&&n.target.tagName.toLowerCase()!=="button"&&n.target.tagName.toLowerCase()!=="i"&&n.target.tagName.toLowerCase()!=="select"&&!this.zoomButtonActive&&i&&n.preventDefault()}},mouseup:n=>{this.shown&&(this.handleToolEvent("handleMouseUp",n),this.colorPicker.handleMouseUp(n))},wheel:(n,i,c,l)=>{this.shown&&!this.params.disableWheelZoom&&(c!==void 0?c:n.ctrlKey)&&(this.zoomImage(n,i,l),n.preventDefault())},keydown:n=>{let i=event.target;if(!["input","textarea","div[contenteditable]"].some((c=>i.matches(c)))&&this.shown){if(this.colorPicker.handleKeyDown(n)||this.handleClipCopyEvent(n))return;let c=window.event?event:n;if(this.handleToolEvent("handleKeyDown",c))return;c.keyCode===mt.y&&c.ctrlKey||c.keyCode===mt.z&&c.ctrlKey&&c.shiftKey?(this.worklog.redoState(),n.preventDefault(),this.params.userRedo&&this.params.userRedo.call()):c.keyCode===mt.z&&c.ctrlKey&&(this.worklog.undoState(),n.preventDefault(),this.params.userUndo&&this.params.userUndo.call()),this.toolByKeyCode[event.keyCode]&&(this.getBtnEl(this.toolByKeyCode[event.keyCode]).click(),n.stopPropagation(),n.preventDefault()),this.saveBtn&&c.keyCode===mt.s&&c.ctrlKey&&(this.initText&&this.wrapper.click(),this.save(),c.preventDefault())}},paste:n=>{if(this.initText&&this.wrapper.click(),this.shown){let i=(n.clipboardData||n.originalEvent.clipboardData).items;Object.keys(i).forEach((c=>{let l=i[c];l.kind==="file"&&l.type.split("/")[0]==="image"&&(this.openFile(l.getAsFile()),n.preventDefault(),n.stopPropagation())}))}},dragover:n=>{if(this.shown){let i=n.target.classList[0];i!=="ptro-crp-el"&&i!=="ptro-bar"||(this.bar.className="ptro-bar ptro-color-main ptro-bar-dragover"),n.preventDefault()}},dragleave:()=>{this.shown&&(this.bar.className="ptro-bar ptro-color-main")},drop:n=>{if(this.shown){this.bar.className="ptro-bar ptro-color-main",n.preventDefault();let i=n.dataTransfer.files[0];if(i)this.openFile(i);else{let c=n.dataTransfer.getData("text/html"),l=/src.*?=['"](.+?)['"]/.exec(c);this.inserter.handleOpen(l[1])}}}},this.windowHandlers={resize:()=>{this.shown&&(this.adjustSizeFull(),this.syncToolElement())}},this.listenersInstalled=!1}attachEventHandlers(){this.listenersInstalled||(Object.keys(this.documentHandlers).forEach((n=>{this.doc.addEventListener(n,this.documentHandlers[n],{passive:!1})})),Object.keys(this.windowHandlers).forEach((n=>{window.addEventListener(n,this.windowHandlers[n],{passive:!1})})),this.listenersInstalled=!0)}removeEventHandlers(){this.listenersInstalled&&(Object.keys(this.documentHandlers).forEach((n=>{this.doc.removeEventListener(n,this.documentHandlers[n])})),Object.keys(this.windowHandlers).forEach((n=>{window.removeEventListener(n,this.windowHandlers[n])})),this.listenersInstalled=!1)}elLeft(){return this.toolContainer.documentOffsetLeft+this.scroller.scrollLeft}elTop(){return this.toolContainer.documentOffsetTop+this.scroller.scrollTop}fitImage(n,i){this.loadedImageType=i,this.resize(n.naturalWidth,n.naturalHeight),this.ctx.drawImage(n,0,0);let c=Math.min(this.wrapper.documentClientHeight/this.size.h,this.wrapper.documentClientWidth/this.size.w);this.zoomFactor=c,this.adjustSizeFull(),this.worklog.captureState()}loadImage(n,i){this.inserter.handleOpen(n,i)}show(n,i){return this.shown=!0,this.scrollWidth=(function(){let c=document.createElement("div");c.style.visibility="hidden",c.style.width="100px",c.style.msOverflowStyle="scrollbar",document.body.appendChild(c);let l=c.offsetWidth;c.style.overflow="scroll";let f=document.createElement("div");f.style.width="100%",c.appendChild(f);let C=f.offsetWidth;return c.parentNode.removeChild(c),l-C})(),this.isMobile&&(this.origOverflowY=this.body.style["overflow-y"],this.params.fixMobilePageReloader&&(this.body.style["overflow-y"]="hidden")),this.baseEl.removeAttribute("hidden"),this.holderEl&&this.holderEl.removeAttribute("hidden"),typeof n=="string"?(this.loadedName=Mt((n.substring(n.lastIndexOf("/")+1)||"").replace(/\..+$/,"")),this.loadImage(n,i)):n!==!1&&this.clear(),this.attachEventHandlers(),this}hide(){return this.isMobile&&(this.body.style["overflow-y"]=this.origOverflowY),this.shown=!1,this.baseEl.setAttribute("hidden",""),this.holderEl&&this.holderEl.setAttribute("hidden",""),this.removeEventHandlers(),this.params.onHide!==void 0&&this.params.onHide(),this}setZoom(n){if(!this.size)return;this.zoomFactor=n/100;let i=1;this.size.w>this.wrapper.documentClientWidth&&(i=Math.min(i,this.wrapper.documentClientWidth/this.size.w)),this.size.h>this.wrapper.documentClientHeight&&(i=Math.min(i,this.wrapper.documentClientHeight/this.size.h)),!this.zoom&&this.zoomFactor>i&&(this.zoomFactor=i),this.zoomFactor<i?(this.zoom=!1,this.zoomFactor=i):this.zoom=!0,this.adjustSizeFull(),this.select.adjustPosition();let c=this.canvas.getBoundingClientRect();this.curCord=[c.right/2-this.elLeft()+this.scroller.scrollLeft,c.bottom/2-this.elTop()+this.scroller.scrollTop];let l=this.getScale();this.curCord=[this.curCord[0]*l,this.curCord[1]*l],this.zoom&&(this.scroller.scrollLeft=this.curCord[0]/this.getScale()-(c.right/2-this.wrapper.documentOffsetLeft),this.scroller.scrollTop=this.curCord[1]/this.getScale()-(c.bottom/2-this.wrapper.documentOffsetTop))}doScale({width:n,height:i,scale:c}){if(c){if(n||i)throw new Error("You can't pass width or height and scale at the same time");this.resizer.newW=Math.round(this.size.w*c),this.resizer.newH=Math.round(this.size.h*c)}else{if(c)throw new Error("You can't pass width or height and scale at the same time");this.resizer.newW=n||Math.round(this.size.w*(i/this.size.h)),this.resizer.newH=i||Math.round(this.size.h*(n/this.size.w))}this.resizer.scaleButton.onclick()}openFile(n){if(!n)return;this.loadedName=Mt((n.name||"").replace(/\..+$/,""));let i=(window.URL?window.URL:window.webkitURL).createObjectURL(n);this.loadImage(i,n.type)}getScale(){return this.canvas.getAttribute("width")/this.canvas.offsetWidth}adjustSizeFull(){let n=this.wrapper.documentClientWidth/this.wrapper.documentClientHeight;if(this.zoom===!1&&this.textTool.active===!1){if(this.size.w>this.wrapper.documentClientWidth||this.size.h>this.wrapper.documentClientHeight){let i=n<this.size.ratio;this.ratioRelation=i,i?(this.canvas.style.width=`${this.wrapper.clientWidth}px`,this.canvas.style.height="auto"):(this.canvas.style.width="auto",this.canvas.style.height=`${this.wrapper.clientHeight}px`)}else this.canvas.style.width="auto",this.canvas.style.height="auto",this.ratioRelation=0;this.scroller.style.overflow="hidden"}else this.zoom===!1?this.scroller.style.overflow="hidden":this.scroller.style.overflow="scroll",this.canvas.style.width=this.size.w*this.zoomFactor+"px",this.canvas.style.height=this.size.h*this.zoomFactor+"px",this.ratioRelation=0;this.syncToolElement(),this.select.draw()}resize(n,i){this.info.innerHTML=`${n}<span>x</span>${i}<br>${(this.originalMime||"png").replace("image/","")}`,this.size={w:n,h:i,ratio:n/i},this.canvas.setAttribute("width",this.size.w),this.canvas.setAttribute("height",this.size.h)}syncToolElement(){let n=Math.round(this.canvas.documentClientWidth),i=this.canvas.offsetLeft,c=Math.round(this.canvas.documentClientHeight),l=this.canvas.offsetTop;this.toolContainer.style.left=`${i}px`,this.toolContainer.style.width=`${n}px`,this.toolContainer.style.top=`${l}px`,this.toolContainer.style.height=`${c}px`,this.substrate.style.left=`${i}px`,this.substrate.style.width=`${n}px`,this.substrate.style.top=`${l}px`,this.substrate.style.height=`${c}px`}clear(){let n=this.params.defaultSize.width==="fill"?this.wrapper.clientWidth:this.params.defaultSize.width,i=this.params.defaultSize.height==="fill"?this.wrapper.clientHeight:this.params.defaultSize.height;if(this.resize(n,i),this.clearBackground(),this.worklog.captureState(!0),this.worklog.clean=!0,this.syncToolElement(),this.adjustSizeFull(),this.params.initText&&this.worklog.empty){this.ctx.lineWidth=3,this.ctx.strokeStyle="#fff";let c=this.wrapper.querySelectorAll(".init-text");c.length>0&&c.forEach((l=>{l.remove()})),this.initText=document.createElement("div"),this.initText.classList.add("init-text"),this.wrapper.append(this.initText),this.initText.innerHTML=`<div style="pointer-events: none;position:absolute;top:50%;width:100%;left: 50%; transform: translate(-50%, -50%)">${this.params.initText}</div>`,this.initText.style.left="0",this.initText.style.top="0",this.initText.style.right="0",this.initText.style.bottom="0",this.initText.style.pointerEvents="none",this.initText.style["text-align"]="center",this.initText.style.position="absolute",this.initText.style.color=this.params.initTextColor,this.initText.style["font-family"]=this.params.initTextStyle.split(/ (.+)/)[1],this.initText.style["font-size"]=this.params.initTextStyle.split(/ (.+)/)[0],this.wrapper.addEventListener("click",(()=>{this.initText.remove(),this.initText=null}),{once:!0})}}clearBackground(){this.ctx.beginPath(),this.ctx.clearRect(0,0,this.size.w,this.size.h),this.ctx.rect(0,0,this.size.w,this.size.h),this.ctx.fillStyle=this.currentBackground,this.ctx.fill()}setColor(n){this.doc.querySelector(`#${this.id} .ptro-color-btn[data-id='${n[0]}']`).style["background-color"]=n[1].alphaColor,this.colorWidgetState={...this.colorWidgetState,line:{target:n[0],palleteColor:n[1].palleteColor,alpha:n[1].alpha,alphaColor:n[1].alphaColor}}}setLineWidth(n){Ae(n,this.primitiveTool,"setLineWidth","lineWidth")}setArrowLength(n){Ae(n,this.primitiveTool,"setArrowLength","arrowLength")}setEraserWidth(n){Ae(n,this.primitiveTool,"setEraserWidth","eraserWidth")}setPixelSize(n){Ae(n,this.primitiveTool,"setPixelSize","pixelSize")}setShadowOn(n){Ae(n,this.primitiveTool,"setShadowOn","shadowOn")}setActiveTool(n){this.activeTool=n,this.zoomButtonActive=!1;let i=this.getBtnEl(this.activeTool);i&&(i.className+=" ptro-color-active-control");let c="";(n.controls||[]).forEach((l=>{if(l.id=$t(),l.title&&(c+=`<span class="ptro-tool-ctl-name" title="${Ct(l.titleFull)}">${Ct(l.title)}</span>`),l.type==="btn")c+=`<button type="button" ${l.hint?`title="${Ct(l.hint)}"`:""} class="ptro-color-control ${l.icon?"ptro-icon-btn":"ptro-named-btn"}" id=${l.id}>${l.icon?`<i class="ptro-icon ptro-icon-${l.icon}"></i>`:""}<p>${l.name||""}</p></button>`;else if(l.type==="color")c+=`<button type="button" id=${l.id} data-id='${l.target}' style="background-color: ${this.colorWidgetState[l.target].alphaColor}" class="color-diwget-btn ptro-color-btn ptro-bordered-btn ptro-color-control"></button><span class="ptro-btn-color-checkers-bar"></span>`;else if(l.type==="int")c+=`<input id=${l.id} class="ptro-input" type="number" min="${l.min}" max="${l.max}" data-id='${l.target}'/>`;else if(l.type==="bool")c+=`<button id=${l.id} class="ptro-input ptro-check" data-value="false" type="button" data-id='${l.target}'></button>`;else if(l.type==="dropdown"){let f="";l.getAvailableValues().forEach((C=>{f+="<option "+(C.extraStyle?`style='${C.extraStyle}'`:"")+` value='${C.value}' ${C.title?`title='${C.title}'`:""}>${C.name}</option>`})),c+=`<select id=${l.id} class="ptro-input" data-id='${l.target}'>${f}</select>`}})),this.toolControls.innerHTML=c,(n.controls||[]).forEach((l=>{l.type==="int"?(this.getElemByIdSafe(l.id).value=l.getValue(),l.options&&l.options.eventOnChange?this.getElemByIdSafe(l.id).onchange=l.action:this.getElemByIdSafe(l.id).oninput=l.action):l.type==="bool"?(this.getElemByIdSafe(l.id).setAttribute("data-value",l.getValue()?"true":"false"),this.getElemByIdSafe(l.id).onclick=l.action):l.type==="dropdown"?(this.getElemByIdSafe(l.id).onchange=l.action,this.getElemByIdSafe(l.id).value=l.getValue()):this.getElemByIdSafe(l.id).onclick=l.action})),n.activate()}}let gi=j=>new fi(j)},486:function(O,_,S){var $;O=S.nmd(O),function(){var h,U="Expected a function",it="__lodash_hash_undefined__",et="__lodash_placeholder__",bt=16,pt=32,ut=64,dt=128,_t=256,H=1/0,Q=9007199254740991,D=NaN,F=4294967295,b=[["ary",dt],["bind",1],["bindKey",2],["curry",8],["curryRight",bt],["flip",512],["partial",pt],["partialRight",ut],["rearg",_t]],B="[object Arguments]",z="[object Array]",Y="[object Boolean]",Z="[object Date]",rt="[object Error]",lt="[object Function]",gt="[object GeneratorFunction]",At="[object Map]",Lt="[object Number]",St="[object Object]",$t="[object Promise]",ne="[object RegExp]",Mt="[object Set]",mt="[object String]",fe="[object Symbol]",Ae="[object WeakMap]",Ee="[object ArrayBuffer]",Fe="[object DataView]",lr="[object Float32Array]",ge="[object Float64Array]",De="[object Int8Array]",Pe="[object Int16Array]",Dr="[object Int32Array]",Pr="[object Uint8Array]",_r="[object Uint8ClampedArray]",Yr="[object Uint16Array]",jr="[object Uint32Array]",si=/\b__p \+= '';/g,Ai=/\b(__p \+=) '' \+/g,ci=/(__e\(.*?\)|\b__t\)) \+\n'';/g,sn=/&(?:amp|lt|gt|quot|#39);/g,Br=/[&<>"']/g,Ke=RegExp(sn.source),Ct=RegExp(Br.source),sr=/<%-([\s\S]+?)%>/g,_e=/<%([\s\S]+?)%>/g,vr=/<%=([\s\S]+?)%>/g,br=/\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/,An=/^\w*$/,cn=/[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g,xt=/[\\^$.*+?()[\]{}|]/g,Dt=RegExp(xt.source),Kt=/^\s+|\s+$/g,hn=/^\s+/,pn=/\s+$/,hi=/\{(?:\n\/\* \[wrapped with .+\] \*\/)?\n?/,pi=/\{\n\/\* \[wrapped with (.+)\] \*/,un=/,? & /,Ye=/[^\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]+/g,Ar=/\\(\\)?/g,dn=/\$\{([^\\}]*(?:\\.[^\\}]*)*)\}/g,ie=/\w*$/,ui=/^[-+]0x[0-9a-f]+$/i,fn=/^0b[01]+$/i,di=/^\[object .+?Constructor\]$/,fi=/^0o[0-7]+$/i,gi=/^(?:0|[1-9]\d*)$/,j=/[\xc0-\xd6\xd8-\xf6\xf8-\xff\u0100-\u017f]/g,n=/($^)/,i=/['\n\r\u2028\u2029\\]/g,c="\\u0300-\\u036f\\ufe20-\\ufe2f\\u20d0-\\u20ff",l="\\u2700-\\u27bf",f="a-z\\xdf-\\xf6\\xf8-\\xff",C="A-Z\\xc0-\\xd6\\xd8-\\xde",p="\\ufe0e\\ufe0f",w="\\xac\\xb1\\xd7\\xf7\\x00-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\xbf\\u2000-\\u206f \\t\\x0b\\f\\xa0\\ufeff\\n\\r\\u2028\\u2029\\u1680\\u180e\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u202f\\u205f\\u3000",W="['\u2019]",ot="[\\ud800-\\udfff]",zt="["+w+"]",Bt="["+c+"]",Ut="\\d+",Tt="[\\u2700-\\u27bf]",Vt="["+f+"]",Yt="[^\\ud800-\\udfff"+w+Ut+l+f+C+"]",Ie="\\ud83c[\\udffb-\\udfff]",cr="[^\\ud800-\\udfff]",Rr="(?:\\ud83c[\\udde6-\\uddff]){2}",Nr="[\\ud800-\\udbff][\\udc00-\\udfff]",Ve="["+C+"]",Or="(?:"+Vt+"|"+Yt+")",jl="(?:"+Ve+"|"+Yt+")",Io="(?:['\u2019](?:d|ll|m|re|s|t|ve))?",ko="(?:['\u2019](?:D|LL|M|RE|S|T|VE))?",So="(?:"+Bt+"|"+Ie+")?",zo="[\\ufe0e\\ufe0f]?",Eo=zo+So+("(?:\\u200d(?:"+[cr,Rr,Nr].join("|")+")"+zo+So+")*"),Rl="(?:"+[Tt,Rr,Nr].join("|")+")"+Eo,Nl="(?:"+[cr+Bt+"?",Bt,Rr,Nr,ot].join("|")+")",Ol=RegExp(W,"g"),Hl=RegExp(Bt,"g"),mi=RegExp(Ie+"(?="+Ie+")|"+Nl+Eo,"g"),Ul=RegExp([Ve+"?"+Vt+"+"+Io+"(?="+[zt,Ve,"$"].join("|")+")",jl+"+"+ko+"(?="+[zt,Ve+Or,"$"].join("|")+")",Ve+"?"+Or+"+"+Io,Ve+"+"+ko,"\\d*(?:1ST|2ND|3RD|(?![123])\\dTH)(?=\\b|[a-z_])","\\d*(?:1st|2nd|3rd|(?![123])\\dth)(?=\\b|[A-Z_])",Ut,Rl].join("|"),"g"),Gl=RegExp("[\\u200d\\ud800-\\udfff"+c+p+"]"),Jl=/[a-z][A-Z]|[A-Z]{2}[a-z]|[0-9][a-zA-Z]|[a-zA-Z][0-9]|[^a-zA-Z0-9 ]/,Zl=["Array","Buffer","DataView","Date","Error","Float32Array","Float64Array","Function","Int8Array","Int16Array","Int32Array","Map","Math","Object","Promise","RegExp","Set","String","Symbol","TypeError","Uint8Array","Uint8ClampedArray","Uint16Array","Uint32Array","WeakMap","_","clearTimeout","isFinite","parseInt","setTimeout"],Kl=-1,It={};It[lr]=It[ge]=It[De]=It[Pe]=It[Dr]=It[Pr]=It[_r]=It[Yr]=It[jr]=!0,It[B]=It[z]=It[Ee]=It[Y]=It[Fe]=It[Z]=It[rt]=It[lt]=It[At]=It[Lt]=It[St]=It[ne]=It[Mt]=It[mt]=It[Ae]=!1;var yt={};yt[B]=yt[z]=yt[Ee]=yt[Fe]=yt[Y]=yt[Z]=yt[lr]=yt[ge]=yt[De]=yt[Pe]=yt[Dr]=yt[At]=yt[Lt]=yt[St]=yt[ne]=yt[Mt]=yt[mt]=yt[fe]=yt[Pr]=yt[_r]=yt[Yr]=yt[jr]=!0,yt[rt]=yt[lt]=yt[Ae]=!1;var Vl={"\\":"\\","'":"'","\n":"n","\r":"r","\u2028":"u2028","\u2029":"u2029"},Xl=parseFloat,ql=parseInt,Fo=typeof S.g=="object"&&S.g&&S.g.Object===Object&&S.g,$l=typeof self=="object"&&self&&self.Object===Object&&self,Jt=Fo||$l||Function("return this")(),To=_&&!_.nodeType&&_,Hr=To&&O&&!O.nodeType&&O,Wo=Hr&&Hr.exports===To,Ci=Wo&&Fo.process,me=(function(){try{var m=Hr&&Hr.require&&Hr.require("util").types;return m||Ci&&Ci.binding&&Ci.binding("util")}catch{}})(),Lo=me&&me.isArrayBuffer,Qo=me&&me.isDate,Mo=me&&me.isMap,Do=me&&me.isRegExp,Po=me&&me.isSet,_o=me&&me.isTypedArray;function ce(m,I,y){switch(y.length){case 0:return m.call(I);case 1:return m.call(I,y[0]);case 2:return m.call(I,y[0],y[1]);case 3:return m.call(I,y[0],y[1],y[2])}return m.apply(I,y)}function ts(m,I,y,L){for(var tt=-1,ft=m==null?0:m.length;++tt<ft;){var jt=m[tt];I(L,jt,y(jt),m)}return L}function Ce(m,I){for(var y=-1,L=m==null?0:m.length;++y<L&&I(m[y],y,m)!==!1;);return m}function es(m,I){for(var y=m==null?0:m.length;y--&&I(m[y],y,m)!==!1;);return m}function Yo(m,I){for(var y=-1,L=m==null?0:m.length;++y<L;)if(!I(m[y],y,m))return!1;return!0}function Xe(m,I){for(var y=-1,L=m==null?0:m.length,tt=0,ft=[];++y<L;){var jt=m[y];I(jt,y,m)&&(ft[tt++]=jt)}return ft}function gn(m,I){return!!(m!=null&&m.length)&&xr(m,I,0)>-1}function wi(m,I,y){for(var L=-1,tt=m==null?0:m.length;++L<tt;)if(y(I,m[L]))return!0;return!1}function Et(m,I){for(var y=-1,L=m==null?0:m.length,tt=Array(L);++y<L;)tt[y]=I(m[y],y,m);return tt}function qe(m,I){for(var y=-1,L=I.length,tt=m.length;++y<L;)m[tt+y]=I[y];return m}function Bi(m,I,y,L){var tt=-1,ft=m==null?0:m.length;for(L&&ft&&(y=m[++tt]);++tt<ft;)y=I(y,m[tt],tt,m);return y}function rs(m,I,y,L){var tt=m==null?0:m.length;for(L&&tt&&(y=m[--tt]);tt--;)y=I(y,m[tt],tt,m);return y}function vi(m,I){for(var y=-1,L=m==null?0:m.length;++y<L;)if(I(m[y],y,m))return!0;return!1}var ns=bi("length");function jo(m,I,y){var L;return y(m,(function(tt,ft,jt){if(I(tt,ft,jt))return L=ft,!1})),L}function mn(m,I,y,L){for(var tt=m.length,ft=y+(L?1:-1);L?ft--:++ft<tt;)if(I(m[ft],ft,m))return ft;return-1}function xr(m,I,y){return I==I?(function(L,tt,ft){for(var jt=ft-1,Te=L.length;++jt<Te;)if(L[jt]===tt)return jt;return-1})(m,I,y):mn(m,Ro,y)}function is(m,I,y,L){for(var tt=y-1,ft=m.length;++tt<ft;)if(L(m[tt],I))return tt;return-1}function Ro(m){return m!=m}function No(m,I){var y=m==null?0:m.length;return y?yi(m,I)/y:D}function bi(m){return function(I){return I==null?h:I[m]}}function xi(m){return function(I){return m==null?h:m[I]}}function Oo(m,I,y,L,tt){return tt(m,(function(ft,jt,Te){y=L?(L=!1,ft):I(y,ft,jt,Te)})),y}function yi(m,I){for(var y,L=-1,tt=m.length;++L<tt;){var ft=I(m[L]);ft!==h&&(y=y===h?ft:y+ft)}return y}function Ii(m,I){for(var y=-1,L=Array(m);++y<m;)L[y]=I(y);return L}function he(m){return function(I){return m(I)}}function ki(m,I){return Et(I,(function(y){return m[y]}))}function Ur(m,I){return m.has(I)}function Ho(m,I){for(var y=-1,L=m.length;++y<L&&xr(I,m[y],0)>-1;);return y}function Uo(m,I){for(var y=m.length;y--&&xr(I,m[y],0)>-1;);return y}function os(m,I){for(var y=m.length,L=0;y--;)m[y]===I&&++L;return L}var as=xi({\u00C0:"A",\u00C1:"A",\u00C2:"A",\u00C3:"A",\u00C4:"A",\u00C5:"A",\u00E0:"a",\u00E1:"a",\u00E2:"a",\u00E3:"a",\u00E4:"a",\u00E5:"a",\u00C7:"C",\u00E7:"c",\u00D0:"D",\u00F0:"d",\u00C8:"E",\u00C9:"E",\u00CA:"E",\u00CB:"E",\u00E8:"e",\u00E9:"e",\u00EA:"e",\u00EB:"e",\u00CC:"I",\u00CD:"I",\u00CE:"I",\u00CF:"I",\u00EC:"i",\u00ED:"i",\u00EE:"i",\u00EF:"i",\u00D1:"N",\u00F1:"n",\u00D2:"O",\u00D3:"O",\u00D4:"O",\u00D5:"O",\u00D6:"O",\u00D8:"O",\u00F2:"o",\u00F3:"o",\u00F4:"o",\u00F5:"o",\u00F6:"o",\u00F8:"o",\u00D9:"U",\u00DA:"U",\u00DB:"U",\u00DC:"U",\u00F9:"u",\u00FA:"u",\u00FB:"u",\u00FC:"u",\u00DD:"Y",\u00FD:"y",\u00FF:"y",\u00C6:"Ae",\u00E6:"ae",\u00DE:"Th",\u00FE:"th",\u00DF:"ss",\u0100:"A",\u0102:"A",\u0104:"A",\u0101:"a",\u0103:"a",\u0105:"a",\u0106:"C",\u0108:"C",\u010A:"C",\u010C:"C",\u0107:"c",\u0109:"c",\u010B:"c",\u010D:"c",\u010E:"D",\u0110:"D",\u010F:"d",\u0111:"d",\u0112:"E",\u0114:"E",\u0116:"E",\u0118:"E",\u011A:"E",\u0113:"e",\u0115:"e",\u0117:"e",\u0119:"e",\u011B:"e",\u011C:"G",\u011E:"G",\u0120:"G",\u0122:"G",\u011D:"g",\u011F:"g",\u0121:"g",\u0123:"g",\u0124:"H",\u0126:"H",\u0125:"h",\u0127:"h",\u0128:"I",\u012A:"I",\u012C:"I",\u012E:"I",\u0130:"I",\u0129:"i",\u012B:"i",\u012D:"i",\u012F:"i",\u0131:"i",\u0134:"J",\u0135:"j",\u0136:"K",\u0137:"k",\u0138:"k",\u0139:"L",\u013B:"L",\u013D:"L",\u013F:"L",\u0141:"L",\u013A:"l",\u013C:"l",\u013E:"l",\u0140:"l",\u0142:"l",\u0143:"N",\u0145:"N",\u0147:"N",\u014A:"N",\u0144:"n",\u0146:"n",\u0148:"n",\u014B:"n",\u014C:"O",\u014E:"O",\u0150:"O",\u014D:"o",\u014F:"o",\u0151:"o",\u0154:"R",\u0156:"R",\u0158:"R",\u0155:"r",\u0157:"r",\u0159:"r",\u015A:"S",\u015C:"S",\u015E:"S",\u0160:"S",\u015B:"s",\u015D:"s",\u015F:"s",\u0161:"s",\u0162:"T",\u0164:"T",\u0166:"T",\u0163:"t",\u0165:"t",\u0167:"t",\u0168:"U",\u016A:"U",\u016C:"U",\u016E:"U",\u0170:"U",\u0172:"U",\u0169:"u",\u016B:"u",\u016D:"u",\u016F:"u",\u0171:"u",\u0173:"u",\u0174:"W",\u0175:"w",\u0176:"Y",\u0177:"y",\u0178:"Y",\u0179:"Z",\u017B:"Z",\u017D:"Z",\u017A:"z",\u017C:"z",\u017E:"z",\u0132:"IJ",\u0133:"ij",\u0152:"Oe",\u0153:"oe",\u0149:"'n",\u017F:"s"}),ls=xi({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"});function ss(m){return"\\"+Vl[m]}function yr(m){return Gl.test(m)}function Si(m){var I=-1,y=Array(m.size);return m.forEach((function(L,tt){y[++I]=[tt,L]})),y}function Go(m,I){return function(y){return m(I(y))}}function $e(m,I){for(var y=-1,L=m.length,tt=0,ft=[];++y<L;){var jt=m[y];jt!==I&&jt!==et||(m[y]=et,ft[tt++]=y)}return ft}function Cn(m){var I=-1,y=Array(m.size);return m.forEach((function(L){y[++I]=L})),y}function As(m){var I=-1,y=Array(m.size);return m.forEach((function(L){y[++I]=[L,L]})),y}function Ir(m){return yr(m)?(function(I){for(var y=mi.lastIndex=0;mi.test(I);)++y;return y})(m):ns(m)}function ke(m){return yr(m)?(function(I){return I.match(mi)||[]})(m):(function(I){return I.split("")})(m)}var cs=xi({"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&#39;":"'"}),wn=(function m(I){var y,L=(I=I==null?Jt:wn.defaults(Jt.Object(),I,wn.pick(Jt,Zl))).Array,tt=I.Date,ft=I.Error,jt=I.Function,Te=I.Math,kt=I.Object,zi=I.RegExp,hs=I.String,we=I.TypeError,Bn=L.prototype,ps=jt.prototype,kr=kt.prototype,vn=I["__core-js_shared__"],bn=ps.toString,vt=kr.hasOwnProperty,us=0,Jo=(y=/[^.]+$/.exec(vn&&vn.keys&&vn.keys.IE_PROTO||""))?"Symbol(src)_1."+y:"",xn=kr.toString,ds=bn.call(kt),fs=Jt._,gs=zi("^"+bn.call(vt).replace(xt,"\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g,"$1.*?")+"$"),yn=Wo?I.Buffer:h,tr=I.Symbol,In=I.Uint8Array,Zo=yn?yn.allocUnsafe:h,kn=Go(kt.getPrototypeOf,kt),Ko=kt.create,Vo=kr.propertyIsEnumerable,Sn=Bn.splice,Xo=tr?tr.isConcatSpreadable:h,Gr=tr?tr.iterator:h,hr=tr?tr.toStringTag:h,zn=(function(){try{var t=gr(kt,"defineProperty");return t({},"",{}),t}catch{}})(),ms=I.clearTimeout!==Jt.clearTimeout&&I.clearTimeout,Cs=tt&&tt.now!==Jt.Date.now&&tt.now,ws=I.setTimeout!==Jt.setTimeout&&I.setTimeout,En=Te.ceil,Fn=Te.floor,Ei=kt.getOwnPropertySymbols,Bs=yn?yn.isBuffer:h,qo=I.isFinite,vs=Bn.join,bs=Go(kt.keys,kt),Rt=Te.max,Xt=Te.min,xs=tt.now,ys=I.parseInt,$o=Te.random,Is=Bn.reverse,Fi=gr(I,"DataView"),Jr=gr(I,"Map"),Ti=gr(I,"Promise"),Sr=gr(I,"Set"),Zr=gr(I,"WeakMap"),Kr=gr(kt,"create"),Tn=Zr&&new Zr,zr={},ks=mr(Fi),Ss=mr(Jr),zs=mr(Ti),Es=mr(Sr),Fs=mr(Zr),Wn=tr?tr.prototype:h,Vr=Wn?Wn.valueOf:h,ta=Wn?Wn.toString:h;function s(t){if(Wt(t)&&!nt(t)&&!(t instanceof ht)){if(t instanceof Be)return t;if(vt.call(t,"__wrapped__"))return el(t)}return new Be(t)}var Er=(function(){function t(){}return function(e){if(!Ft(e))return{};if(Ko)return Ko(e);t.prototype=e;var r=new t;return t.prototype=h,r}})();function Ln(){}function Be(t,e){this.__wrapped__=t,this.__actions__=[],this.__chain__=!!e,this.__index__=0,this.__values__=h}function ht(t){this.__wrapped__=t,this.__actions__=[],this.__dir__=1,this.__filtered__=!1,this.__iteratees__=[],this.__takeCount__=F,this.__views__=[]}function pr(t){var e=-1,r=t==null?0:t.length;for(this.clear();++e<r;){var o=t[e];this.set(o[0],o[1])}}function je(t){var e=-1,r=t==null?0:t.length;for(this.clear();++e<r;){var o=t[e];this.set(o[0],o[1])}}function Re(t){var e=-1,r=t==null?0:t.length;for(this.clear();++e<r;){var o=t[e];this.set(o[0],o[1])}}function ur(t){var e=-1,r=t==null?0:t.length;for(this.__data__=new Re;++e<r;)this.add(t[e])}function Se(t){var e=this.__data__=new je(t);this.size=e.size}function ea(t,e){var r=nt(t),o=!r&&Cr(t),a=!r&&!o&&or(t),A=!r&&!o&&!a&&Lr(t),u=r||o||a||A,d=u?Ii(t.length,hs):[],g=d.length;for(var v in t)!e&&!vt.call(t,v)||u&&(v=="length"||a&&(v=="offset"||v=="parent")||A&&(v=="buffer"||v=="byteLength"||v=="byteOffset")||Ue(v,g))||d.push(v);return d}function ra(t){var e=t.length;return e?t[Ni(0,e-1)]:h}function Ts(t,e){return Jn(oe(t),dr(e,0,t.length))}function Ws(t){return Jn(oe(t))}function Wi(t,e,r){(r!==h&&!ze(t[e],r)||r===h&&!(e in t))&&Ne(t,e,r)}function Xr(t,e,r){var o=t[e];vt.call(t,e)&&ze(o,r)&&(r!==h||e in t)||Ne(t,e,r)}function Qn(t,e){for(var r=t.length;r--;)if(ze(t[r][0],e))return r;return-1}function Ls(t,e,r,o){return er(t,(function(a,A,u){e(o,a,r(a),u)})),o}function na(t,e){return t&&Le(e,Gt(e),t)}function Ne(t,e,r){e=="__proto__"&&zn?zn(t,e,{configurable:!0,enumerable:!0,value:r,writable:!0}):t[e]=r}function Li(t,e){for(var r=-1,o=e.length,a=L(o),A=t==null;++r<o;)a[r]=A?h:uo(t,e[r]);return a}function dr(t,e,r){return t==t&&(r!==h&&(t=t<=r?t:r),e!==h&&(t=t>=e?t:e)),t}function ve(t,e,r,o,a,A){var u,d=1&e,g=2&e,v=4&e;if(r&&(u=a?r(t,o,a,A):r(t)),u!==h)return u;if(!Ft(t))return t;var x=nt(t);if(x){if(u=(function(k){var T=k.length,V=new k.constructor(T);return T&&typeof k[0]=="string"&&vt.call(k,"index")&&(V.index=k.index,V.input=k.input),V})(t),!d)return oe(t,u)}else{var E=qt(t),P=E==lt||E==gt;if(or(t))return Sa(t,d);if(E==St||E==B||P&&!a){if(u=g||P?{}:Ga(t),!d)return g?(function(k,T){return Le(k,Ha(k),T)})(t,(function(k,T){return k&&Le(T,le(T),k)})(u,t)):(function(k,T){return Le(k,ro(k),T)})(t,na(u,t))}else{if(!yt[E])return a?t:{};u=(function(k,T,V){var M=k.constructor;switch(T){case Ee:return Ki(k);case Y:case Z:return new M(+k);case Fe:return(function(q,ct){var N=ct?Ki(q.buffer):q.buffer;return new q.constructor(N,q.byteOffset,q.byteLength)})(k,V);case lr:case ge:case De:case Pe:case Dr:case Pr:case _r:case Yr:case jr:return za(k,V);case At:return new M;case Lt:case mt:return new M(k);case ne:return(function(q){var ct=new q.constructor(q.source,ie.exec(q));return ct.lastIndex=q.lastIndex,ct})(k);case Mt:return new M;case fe:return X=k,Vr?kt(Vr.call(X)):{}}var X})(t,E,d)}}A||(A=new Se);var R=A.get(t);if(R)return R;A.set(t,u),wl(t)?t.forEach((function(k){u.add(ve(k,e,r,k,t,A))})):ml(t)&&t.forEach((function(k,T){u.set(T,ve(k,e,r,T,t,A))}));var G=x?h:(v?g?$i:qi:g?le:Gt)(t);return Ce(G||t,(function(k,T){G&&(k=t[T=k]),Xr(u,T,ve(k,e,r,T,t,A))})),u}function ia(t,e,r){var o=r.length;if(t==null)return!o;for(t=kt(t);o--;){var a=r[o],A=e[a],u=t[a];if(u===h&&!(a in t)||!A(u))return!1}return!0}function oa(t,e,r){if(typeof t!="function")throw new we(U);return on((function(){t.apply(h,r)}),e)}function qr(t,e,r,o){var a=-1,A=gn,u=!0,d=t.length,g=[],v=e.length;if(!d)return g;r&&(e=Et(e,he(r))),o?(A=wi,u=!1):e.length>=200&&(A=Ur,u=!1,e=new ur(e));t:for(;++a<d;){var x=t[a],E=r==null?x:r(x);if(x=o||x!==0?x:0,u&&E==E){for(var P=v;P--;)if(e[P]===E)continue t;g.push(x)}else A(e,E,o)||g.push(x)}return g}s.templateSettings={escape:sr,evaluate:_e,interpolate:vr,variable:"",imports:{_:s}},s.prototype=Ln.prototype,s.prototype.constructor=s,Be.prototype=Er(Ln.prototype),Be.prototype.constructor=Be,ht.prototype=Er(Ln.prototype),ht.prototype.constructor=ht,pr.prototype.clear=function(){this.__data__=Kr?Kr(null):{},this.size=0},pr.prototype.delete=function(t){var e=this.has(t)&&delete this.__data__[t];return this.size-=e?1:0,e},pr.prototype.get=function(t){var e=this.__data__;if(Kr){var r=e[t];return r===it?h:r}return vt.call(e,t)?e[t]:h},pr.prototype.has=function(t){var e=this.__data__;return Kr?e[t]!==h:vt.call(e,t)},pr.prototype.set=function(t,e){var r=this.__data__;return this.size+=this.has(t)?0:1,r[t]=Kr&&e===h?it:e,this},je.prototype.clear=function(){this.__data__=[],this.size=0},je.prototype.delete=function(t){var e=this.__data__,r=Qn(e,t);return!(r<0)&&(r==e.length-1?e.pop():Sn.call(e,r,1),--this.size,!0)},je.prototype.get=function(t){var e=this.__data__,r=Qn(e,t);return r<0?h:e[r][1]},je.prototype.has=function(t){return Qn(this.__data__,t)>-1},je.prototype.set=function(t,e){var r=this.__data__,o=Qn(r,t);return o<0?(++this.size,r.push([t,e])):r[o][1]=e,this},Re.prototype.clear=function(){this.size=0,this.__data__={hash:new pr,map:new(Jr||je),string:new pr}},Re.prototype.delete=function(t){var e=Gn(this,t).delete(t);return this.size-=e?1:0,e},Re.prototype.get=function(t){return Gn(this,t).get(t)},Re.prototype.has=function(t){return Gn(this,t).has(t)},Re.prototype.set=function(t,e){var r=Gn(this,t),o=r.size;return r.set(t,e),this.size+=r.size==o?0:1,this},ur.prototype.add=ur.prototype.push=function(t){return this.__data__.set(t,it),this},ur.prototype.has=function(t){return this.__data__.has(t)},Se.prototype.clear=function(){this.__data__=new je,this.size=0},Se.prototype.delete=function(t){var e=this.__data__,r=e.delete(t);return this.size=e.size,r},Se.prototype.get=function(t){return this.__data__.get(t)},Se.prototype.has=function(t){return this.__data__.has(t)},Se.prototype.set=function(t,e){var r=this.__data__;if(r instanceof je){var o=r.__data__;if(!Jr||o.length<199)return o.push([t,e]),this.size=++r.size,this;r=this.__data__=new Re(o)}return r.set(t,e),this.size=r.size,this};var er=Wa(We),aa=Wa(Mi,!0);function Qs(t,e){var r=!0;return er(t,(function(o,a,A){return r=!!e(o,a,A)})),r}function Mn(t,e,r){for(var o=-1,a=t.length;++o<a;){var A=t[o],u=e(A);if(u!=null&&(d===h?u==u&&!ue(u):r(u,d)))var d=u,g=A}return g}function la(t,e){var r=[];return er(t,(function(o,a,A){e(o,a,A)&&r.push(o)})),r}function Zt(t,e,r,o,a){var A=-1,u=t.length;for(r||(r=Gs),a||(a=[]);++A<u;){var d=t[A];e>0&&r(d)?e>1?Zt(d,e-1,r,o,a):qe(a,d):o||(a[a.length]=d)}return a}var Qi=La(),sa=La(!0);function We(t,e){return t&&Qi(t,e,Gt)}function Mi(t,e){return t&&sa(t,e,Gt)}function Dn(t,e){return Xe(e,(function(r){return Ge(t[r])}))}function fr(t,e){for(var r=0,o=(e=nr(e,t)).length;t!=null&&r<o;)t=t[Qe(e[r++])];return r&&r==o?t:h}function Aa(t,e,r){var o=e(t);return nt(t)?o:qe(o,r(t))}function te(t){return t==null?t===h?"[object Undefined]":"[object Null]":hr&&hr in kt(t)?(function(e){var r=vt.call(e,hr),o=e[hr];try{e[hr]=h;var a=!0}catch{}var A=xn.call(e);return a&&(r?e[hr]=o:delete e[hr]),A})(t):(function(e){return xn.call(e)})(t)}function Di(t,e){return t>e}function Ms(t,e){return t!=null&&vt.call(t,e)}function Ds(t,e){return t!=null&&e in kt(t)}function Pi(t,e,r){for(var o=r?wi:gn,a=t[0].length,A=t.length,u=A,d=L(A),g=1/0,v=[];u--;){var x=t[u];u&&e&&(x=Et(x,he(e))),g=Xt(x.length,g),d[u]=!r&&(e||a>=120&&x.length>=120)?new ur(u&&x):h}x=t[0];var E=-1,P=d[0];t:for(;++E<a&&v.length<g;){var R=x[E],G=e?e(R):R;if(R=r||R!==0?R:0,!(P?Ur(P,G):o(v,G,r))){for(u=A;--u;){var k=d[u];if(!(k?Ur(k,G):o(t[u],G,r)))continue t}P&&P.push(G),v.push(R)}}return v}function $r(t,e,r){var o=(t=Va(t,e=nr(e,t)))==null?t:t[Qe(xe(e))];return o==null?h:ce(o,t,r)}function ca(t){return Wt(t)&&te(t)==B}function tn(t,e,r,o,a){return t===e||(t==null||e==null||!Wt(t)&&!Wt(e)?t!=t&&e!=e:(function(A,u,d,g,v,x){var E=nt(A),P=nt(u),R=E?z:qt(A),G=P?z:qt(u),k=(R=R==B?St:R)==St,T=(G=G==B?St:G)==St,V=R==G;if(V&&or(A)){if(!or(u))return!1;E=!0,k=!1}if(V&&!k)return x||(x=new Se),E||Lr(A)?Oa(A,u,d,g,v,x):(function(N,K,Nt,de,Me,Ot,Ze){switch(Nt){case Fe:if(N.byteLength!=K.byteLength||N.byteOffset!=K.byteOffset)return!1;N=N.buffer,K=K.buffer;case Ee:return!(N.byteLength!=K.byteLength||!Ot(new In(N),new In(K)));case Y:case Z:case Lt:return ze(+N,+K);case rt:return N.name==K.name&&N.message==K.message;case ne:case mt:return N==K+"";case At:var ar=Si;case Mt:var ln=1&de;if(ar||(ar=Cn),N.size!=K.size&&!ln)return!1;var ri=Ze.get(N);if(ri)return ri==K;de|=2,Ze.set(N,K);var Mr=Oa(ar(N),ar(K),de,Me,Ot,Ze);return Ze.delete(N),Mr;case fe:if(Vr)return Vr.call(N)==Vr.call(K)}return!1})(A,u,R,d,g,v,x);if(!(1&d)){var M=k&&vt.call(A,"__wrapped__"),X=T&&vt.call(u,"__wrapped__");if(M||X){var q=M?A.value():A,ct=X?u.value():u;return x||(x=new Se),v(q,ct,d,g,x)}}return V?(x||(x=new Se),(function(N,K,Nt,de,Me,Ot){var Ze=1&Nt,ar=qi(N),ln=ar.length,ri=qi(K).length;if(ln!=ri&&!Ze)return!1;for(var Mr=ln;Mr--;){var wr=ar[Mr];if(!(Ze?wr in K:vt.call(K,wr)))return!1}var Ll=Ot.get(N),Ql=Ot.get(K);if(Ll&&Ql)return Ll==K&&Ql==N;var ni=!0;Ot.set(N,K),Ot.set(K,N);for(var yo=Ze;++Mr<ln;){var ii=N[wr=ar[Mr]],oi=K[wr];if(de)var Ml=Ze?de(oi,ii,wr,K,N,Ot):de(ii,oi,wr,N,K,Ot);if(!(Ml===h?ii===oi||Me(ii,oi,Nt,de,Ot):Ml)){ni=!1;break}yo||(yo=wr=="constructor")}if(ni&&!yo){var ai=N.constructor,li=K.constructor;ai==li||!("constructor"in N)||!("constructor"in K)||typeof ai=="function"&&ai instanceof ai&&typeof li=="function"&&li instanceof li||(ni=!1)}return Ot.delete(N),Ot.delete(K),ni})(A,u,d,g,v,x)):!1})(t,e,r,o,tn,a))}function _i(t,e,r,o){var a=r.length,A=a,u=!o;if(t==null)return!A;for(t=kt(t);a--;){var d=r[a];if(u&&d[2]?d[1]!==t[d[0]]:!(d[0]in t))return!1}for(;++a<A;){var g=(d=r[a])[0],v=t[g],x=d[1];if(u&&d[2]){if(v===h&&!(g in t))return!1}else{var E=new Se;if(o)var P=o(v,x,g,t,e,E);if(!(P===h?tn(x,v,3,o,E):P))return!1}}return!0}function ha(t){return!(!Ft(t)||(e=t,Jo&&Jo in e))&&(Ge(t)?gs:di).test(mr(t));var e}function pa(t){return typeof t=="function"?t:t==null?se:typeof t=="object"?nt(t)?fa(t[0],t[1]):da(t):Wl(t)}function Yi(t){if(!nn(t))return bs(t);var e=[];for(var r in kt(t))vt.call(t,r)&&r!="constructor"&&e.push(r);return e}function Ps(t){if(!Ft(t))return(function(a){var A=[];if(a!=null)for(var u in kt(a))A.push(u);return A})(t);var e=nn(t),r=[];for(var o in t)(o!="constructor"||!e&&vt.call(t,o))&&r.push(o);return r}function ji(t,e){return t<e}function ua(t,e){var r=-1,o=ae(t)?L(t.length):[];return er(t,(function(a,A,u){o[++r]=e(a,A,u)})),o}function da(t){var e=eo(t);return e.length==1&&e[0][2]?Za(e[0][0],e[0][1]):function(r){return r===t||_i(r,t,e)}}function fa(t,e){return no(t)&&Ja(e)?Za(Qe(t),e):function(r){var o=uo(r,t);return o===h&&o===e?fo(r,t):tn(e,o,3)}}function Pn(t,e,r,o,a){t!==e&&Qi(e,(function(A,u){if(a||(a=new Se),Ft(A))(function(g,v,x,E,P,R,G){var k=oo(g,x),T=oo(v,x),V=G.get(T);if(V)return void Wi(g,x,V);var M=R?R(k,T,x+"",g,v,G):h,X=M===h;if(X){var q=nt(T),ct=!q&&or(T),N=!q&&!ct&&Lr(T);M=T,q||ct||N?nt(k)?M=k:Qt(k)?M=oe(k):ct?(X=!1,M=Sa(T,!0)):N?(X=!1,M=za(T,!0)):M=[]:an(T)||Cr(T)?(M=k,Cr(k)?M=bl(k):Ft(k)&&!Ge(k)||(M=Ga(T))):X=!1}X&&(G.set(T,M),P(M,T,E,R,G),G.delete(T)),Wi(g,x,M)})(t,e,u,r,Pn,o,a);else{var d=o?o(oo(t,u),A,u+"",t,e,a):h;d===h&&(d=A),Wi(t,u,d)}}),le)}function ga(t,e){var r=t.length;if(r)return Ue(e+=e<0?r:0,r)?t[e]:h}function ma(t,e,r){e=e.length?Et(e,(function(a){return nt(a)?function(A){return fr(A,a.length===1?a[0]:a)}:a})):[se];var o=-1;return e=Et(e,he(J())),(function(a,A){var u=a.length;for(a.sort(A);u--;)a[u]=a[u].value;return a})(ua(t,(function(a,A,u){return{criteria:Et(e,(function(d){return d(a)})),index:++o,value:a}})),(function(a,A){return(function(u,d,g){for(var v=-1,x=u.criteria,E=d.criteria,P=x.length,R=g.length;++v<P;){var G=Ea(x[v],E[v]);if(G)return v>=R?G:G*(g[v]=="desc"?-1:1)}return u.index-d.index})(a,A,r)}))}function Ca(t,e,r){for(var o=-1,a=e.length,A={};++o<a;){var u=e[o],d=fr(t,u);r(d,u)&&en(A,nr(u,t),d)}return A}function Ri(t,e,r,o){var a=o?is:xr,A=-1,u=e.length,d=t;for(t===e&&(e=oe(e)),r&&(d=Et(t,he(r)));++A<u;)for(var g=0,v=e[A],x=r?r(v):v;(g=a(d,x,g,o))>-1;)d!==t&&Sn.call(d,g,1),Sn.call(t,g,1);return t}function wa(t,e){for(var r=t?e.length:0,o=r-1;r--;){var a=e[r];if(r==o||a!==A){var A=a;Ue(a)?Sn.call(t,a,1):Ui(t,a)}}return t}function Ni(t,e){return t+Fn($o()*(e-t+1))}function Oi(t,e){var r="";if(!t||e<1||e>Q)return r;do e%2&&(r+=t),(e=Fn(e/2))&&(t+=t);while(e);return r}function st(t,e){return ao(Ka(t,e,se),t+"")}function _s(t){return ra(Qr(t))}function Ys(t,e){var r=Qr(t);return Jn(r,dr(e,0,r.length))}function en(t,e,r,o){if(!Ft(t))return t;for(var a=-1,A=(e=nr(e,t)).length,u=A-1,d=t;d!=null&&++a<A;){var g=Qe(e[a]),v=r;if(g==="__proto__"||g==="constructor"||g==="prototype")return t;if(a!=u){var x=d[g];(v=o?o(x,g,d):h)===h&&(v=Ft(x)?x:Ue(e[a+1])?[]:{})}Xr(d,g,v),d=d[g]}return t}var Ba=Tn?function(t,e){return Tn.set(t,e),t}:se,js=zn?function(t,e){return zn(t,"toString",{configurable:!0,enumerable:!1,value:mo(e),writable:!0})}:se;function Rs(t){return Jn(Qr(t))}function be(t,e,r){var o=-1,a=t.length;e<0&&(e=-e>a?0:a+e),(r=r>a?a:r)<0&&(r+=a),a=e>r?0:r-e>>>0,e>>>=0;for(var A=L(a);++o<a;)A[o]=t[o+e];return A}function Ns(t,e){var r;return er(t,(function(o,a,A){return!(r=e(o,a,A))})),!!r}function _n(t,e,r){var o=0,a=t==null?o:t.length;if(typeof e=="number"&&e==e&&a<=2147483647){for(;o<a;){var A=o+a>>>1,u=t[A];u!==null&&!ue(u)&&(r?u<=e:u<e)?o=A+1:a=A}return a}return Hi(t,e,se,r)}function Hi(t,e,r,o){var a=0,A=t==null?0:t.length;if(A===0)return 0;for(var u=(e=r(e))!=e,d=e===null,g=ue(e),v=e===h;a<A;){var x=Fn((a+A)/2),E=r(t[x]),P=E!==h,R=E===null,G=E==E,k=ue(E);if(u)var T=o||G;else T=v?G&&(o||P):d?G&&P&&(o||!R):g?G&&P&&!R&&(o||!k):!R&&!k&&(o?E<=e:E<e);T?a=x+1:A=x}return Xt(A,4294967294)}function va(t,e){for(var r=-1,o=t.length,a=0,A=[];++r<o;){var u=t[r],d=e?e(u):u;if(!r||!ze(d,g)){var g=d;A[a++]=u===0?0:u}}return A}function ba(t){return typeof t=="number"?t:ue(t)?D:+t}function pe(t){if(typeof t=="string")return t;if(nt(t))return Et(t,pe)+"";if(ue(t))return ta?ta.call(t):"";var e=t+"";return e=="0"&&1/t==-1/0?"-0":e}function rr(t,e,r){var o=-1,a=gn,A=t.length,u=!0,d=[],g=d;if(r)u=!1,a=wi;else if(A>=200){var v=e?null:Hs(t);if(v)return Cn(v);u=!1,a=Ur,g=new ur}else g=e?[]:d;t:for(;++o<A;){var x=t[o],E=e?e(x):x;if(x=r||x!==0?x:0,u&&E==E){for(var P=g.length;P--;)if(g[P]===E)continue t;e&&g.push(E),d.push(x)}else a(g,E,r)||(g!==d&&g.push(E),d.push(x))}return d}function Ui(t,e){return(t=Va(t,e=nr(e,t)))==null||delete t[Qe(xe(e))]}function xa(t,e,r,o){return en(t,e,r(fr(t,e)),o)}function Yn(t,e,r,o){for(var a=t.length,A=o?a:-1;(o?A--:++A<a)&&e(t[A],A,t););return r?be(t,o?0:A,o?A+1:a):be(t,o?A+1:0,o?a:A)}function ya(t,e){var r=t;return r instanceof ht&&(r=r.value()),Bi(e,(function(o,a){return a.func.apply(a.thisArg,qe([o],a.args))}),r)}function Gi(t,e,r){var o=t.length;if(o<2)return o?rr(t[0]):[];for(var a=-1,A=L(o);++a<o;)for(var u=t[a],d=-1;++d<o;)d!=a&&(A[a]=qr(A[a]||u,t[d],e,r));return rr(Zt(A,1),e,r)}function Ia(t,e,r){for(var o=-1,a=t.length,A=e.length,u={};++o<a;){var d=o<A?e[o]:h;r(u,t[o],d)}return u}function Ji(t){return Qt(t)?t:[]}function Zi(t){return typeof t=="function"?t:se}function nr(t,e){return nt(t)?t:no(t,e)?[t]:tl(wt(t))}var Os=st;function ir(t,e,r){var o=t.length;return r=r===h?o:r,!e&&r>=o?t:be(t,e,r)}var ka=ms||function(t){return Jt.clearTimeout(t)};function Sa(t,e){if(e)return t.slice();var r=t.length,o=Zo?Zo(r):new t.constructor(r);return t.copy(o),o}function Ki(t){var e=new t.constructor(t.byteLength);return new In(e).set(new In(t)),e}function za(t,e){var r=e?Ki(t.buffer):t.buffer;return new t.constructor(r,t.byteOffset,t.length)}function Ea(t,e){if(t!==e){var r=t!==h,o=t===null,a=t==t,A=ue(t),u=e!==h,d=e===null,g=e==e,v=ue(e);if(!d&&!v&&!A&&t>e||A&&u&&g&&!d&&!v||o&&u&&g||!r&&g||!a)return 1;if(!o&&!A&&!v&&t<e||v&&r&&a&&!o&&!A||d&&r&&a||!u&&a||!g)return-1}return 0}function Fa(t,e,r,o){for(var a=-1,A=t.length,u=r.length,d=-1,g=e.length,v=Rt(A-u,0),x=L(g+v),E=!o;++d<g;)x[d]=e[d];for(;++a<u;)(E||a<A)&&(x[r[a]]=t[a]);for(;v--;)x[d++]=t[a++];return x}function Ta(t,e,r,o){for(var a=-1,A=t.length,u=-1,d=r.length,g=-1,v=e.length,x=Rt(A-d,0),E=L(x+v),P=!o;++a<x;)E[a]=t[a];for(var R=a;++g<v;)E[R+g]=e[g];for(;++u<d;)(P||a<A)&&(E[R+r[u]]=t[a++]);return E}function oe(t,e){var r=-1,o=t.length;for(e||(e=L(o));++r<o;)e[r]=t[r];return e}function Le(t,e,r,o){var a=!r;r||(r={});for(var A=-1,u=e.length;++A<u;){var d=e[A],g=o?o(r[d],t[d],d,r,t):h;g===h&&(g=t[d]),a?Ne(r,d,g):Xr(r,d,g)}return r}function jn(t,e){return function(r,o){var a=nt(r)?ts:Ls,A=e?e():{};return a(r,t,J(o,2),A)}}function Fr(t){return st((function(e,r){var o=-1,a=r.length,A=a>1?r[a-1]:h,u=a>2?r[2]:h;for(A=t.length>3&&typeof A=="function"?(a--,A):h,u&&ee(r[0],r[1],u)&&(A=a<3?h:A,a=1),e=kt(e);++o<a;){var d=r[o];d&&t(e,d,o,A)}return e}))}function Wa(t,e){return function(r,o){if(r==null)return r;if(!ae(r))return t(r,o);for(var a=r.length,A=e?a:-1,u=kt(r);(e?A--:++A<a)&&o(u[A],A,u)!==!1;);return r}}function La(t){return function(e,r,o){for(var a=-1,A=kt(e),u=o(e),d=u.length;d--;){var g=u[t?d:++a];if(r(A[g],g,A)===!1)break}return e}}function Qa(t){return function(e){var r=yr(e=wt(e))?ke(e):h,o=r?r[0]:e.charAt(0),a=r?ir(r,1).join(""):e.slice(1);return o[t]()+a}}function Tr(t){return function(e){return Bi(Fl(El(e).replace(Ol,"")),t,"")}}function rn(t){return function(){var e=arguments;switch(e.length){case 0:return new t;case 1:return new t(e[0]);case 2:return new t(e[0],e[1]);case 3:return new t(e[0],e[1],e[2]);case 4:return new t(e[0],e[1],e[2],e[3]);case 5:return new t(e[0],e[1],e[2],e[3],e[4]);case 6:return new t(e[0],e[1],e[2],e[3],e[4],e[5]);case 7:return new t(e[0],e[1],e[2],e[3],e[4],e[5],e[6])}var r=Er(t.prototype),o=t.apply(r,e);return Ft(o)?o:r}}function Ma(t){return function(e,r,o){var a=kt(e);if(!ae(e)){var A=J(r,3);e=Gt(e),r=function(d){return A(a[d],d,a)}}var u=t(e,r,o);return u>-1?a[A?e[u]:u]:h}}function Da(t){return He((function(e){var r=e.length,o=r,a=Be.prototype.thru;for(t&&e.reverse();o--;){var A=e[o];if(typeof A!="function")throw new we(U);if(a&&!u&&Un(A)=="wrapper")var u=new Be([],!0)}for(o=u?o:r;++o<r;){var d=Un(A=e[o]),g=d=="wrapper"?to(A):h;u=g&&io(g[0])&&g[1]==424&&!g[4].length&&g[9]==1?u[Un(g[0])].apply(u,g[3]):A.length==1&&io(A)?u[d]():u.thru(A)}return function(){var v=arguments,x=v[0];if(u&&v.length==1&&nt(x))return u.plant(x).value();for(var E=0,P=r?e[E].apply(this,v):x;++E<r;)P=e[E].call(this,P);return P}}))}function Rn(t,e,r,o,a,A,u,d,g,v){var x=e&dt,E=1&e,P=2&e,R=24&e,G=512&e,k=P?h:rn(t);return function T(){for(var V=arguments.length,M=L(V),X=V;X--;)M[X]=arguments[X];if(R)var q=Wr(T),ct=os(M,q);if(o&&(M=Fa(M,o,a,R)),A&&(M=Ta(M,A,u,R)),V-=ct,R&&V<v){var N=$e(M,q);return Ya(t,e,Rn,T.placeholder,r,M,N,d,g,v-V)}var K=E?r:this,Nt=P?K[t]:t;return V=M.length,d?M=Zs(M,d):G&&V>1&&M.reverse(),x&&g<V&&(M.length=g),this&&this!==Jt&&this instanceof T&&(Nt=k||rn(Nt)),Nt.apply(K,M)}}function Pa(t,e){return function(r,o){return(function(a,A,u,d){return We(a,(function(g,v,x){A(d,u(g),v,x)})),d})(r,t,e(o),{})}}function Nn(t,e){return function(r,o){var a;if(r===h&&o===h)return e;if(r!==h&&(a=r),o!==h){if(a===h)return o;typeof r=="string"||typeof o=="string"?(r=pe(r),o=pe(o)):(r=ba(r),o=ba(o)),a=t(r,o)}return a}}function Vi(t){return He((function(e){return e=Et(e,he(J())),st((function(r){var o=this;return t(e,(function(a){return ce(a,o,r)}))}))}))}function On(t,e){var r=(e=e===h?" ":pe(e)).length;if(r<2)return r?Oi(e,t):e;var o=Oi(e,En(t/Ir(e)));return yr(e)?ir(ke(o),0,t).join(""):o.slice(0,t)}function _a(t){return function(e,r,o){return o&&typeof o!="number"&&ee(e,r,o)&&(r=o=h),e=Je(e),r===h?(r=e,e=0):r=Je(r),(function(a,A,u,d){for(var g=-1,v=Rt(En((A-a)/(u||1)),0),x=L(v);v--;)x[d?v:++g]=a,a+=u;return x})(e,r,o=o===h?e<r?1:-1:Je(o),t)}}function Hn(t){return function(e,r){return typeof e=="string"&&typeof r=="string"||(e=ye(e),r=ye(r)),t(e,r)}}function Ya(t,e,r,o,a,A,u,d,g,v){var x=8&e;e|=x?pt:ut,4&(e&=~(x?ut:pt))||(e&=-4);var E=[t,e,a,x?A:h,x?u:h,x?h:A,x?h:u,d,g,v],P=r.apply(h,E);return io(t)&&Xa(P,E),P.placeholder=o,qa(P,t,e)}function Xi(t){var e=Te[t];return function(r,o){if(r=ye(r),(o=o==null?0:Xt(at(o),292))&&qo(r)){var a=(wt(r)+"e").split("e");return+((a=(wt(e(a[0]+"e"+(+a[1]+o)))+"e").split("e"))[0]+"e"+(+a[1]-o))}return e(r)}}var Hs=Sr&&1/Cn(new Sr([,-0]))[1]==H?function(t){return new Sr(t)}:Bo;function ja(t){return function(e){var r=qt(e);return r==At?Si(e):r==Mt?As(e):(function(o,a){return Et(a,(function(A){return[A,o[A]]}))})(e,t(e))}}function Oe(t,e,r,o,a,A,u,d){var g=2&e;if(!g&&typeof t!="function")throw new we(U);var v=o?o.length:0;if(v||(e&=-97,o=a=h),u=u===h?u:Rt(at(u),0),d=d===h?d:at(d),v-=a?a.length:0,e&ut){var x=o,E=a;o=a=h}var P=g?h:to(t),R=[t,e,r,o,a,x,E,A,u,d];if(P&&(function(k,T){var V=k[1],M=T[1],X=V|M,q=X<131,ct=M==dt&&V==8||M==dt&&V==_t&&k[7].length<=T[8]||M==384&&T[7].length<=T[8]&&V==8;if(!q&&!ct)return k;1&M&&(k[2]=T[2],X|=1&V?0:4);var N=T[3];if(N){var K=k[3];k[3]=K?Fa(K,N,T[4]):N,k[4]=K?$e(k[3],et):T[4]}(N=T[5])&&(K=k[5],k[5]=K?Ta(K,N,T[6]):N,k[6]=K?$e(k[5],et):T[6]),(N=T[7])&&(k[7]=N),M&dt&&(k[8]=k[8]==null?T[8]:Xt(k[8],T[8])),k[9]==null&&(k[9]=T[9]),k[0]=T[0],k[1]=X})(R,P),t=R[0],e=R[1],r=R[2],o=R[3],a=R[4],!(d=R[9]=R[9]===h?g?0:t.length:Rt(R[9]-v,0))&&24&e&&(e&=-25),e&&e!=1)G=e==8||e==bt?(function(k,T,V){var M=rn(k);return function X(){for(var q=arguments.length,ct=L(q),N=q,K=Wr(X);N--;)ct[N]=arguments[N];var Nt=q<3&&ct[0]!==K&&ct[q-1]!==K?[]:$e(ct,K);return(q-=Nt.length)<V?Ya(k,T,Rn,X.placeholder,h,ct,Nt,h,h,V-q):ce(this&&this!==Jt&&this instanceof X?M:k,this,ct)}})(t,e,d):e!=pt&&e!=33||a.length?Rn.apply(h,R):(function(k,T,V,M){var X=1&T,q=rn(k);return function ct(){for(var N=-1,K=arguments.length,Nt=-1,de=M.length,Me=L(de+K),Ot=this&&this!==Jt&&this instanceof ct?q:k;++Nt<de;)Me[Nt]=M[Nt];for(;K--;)Me[Nt++]=arguments[++N];return ce(Ot,X?V:this,Me)}})(t,e,r,o);else var G=(function(k,T,V){var M=1&T,X=rn(k);return function q(){return(this&&this!==Jt&&this instanceof q?X:k).apply(M?V:this,arguments)}})(t,e,r);return qa((P?Ba:Xa)(G,R),t,e)}function Ra(t,e,r,o){return t===h||ze(t,kr[r])&&!vt.call(o,r)?e:t}function Na(t,e,r,o,a,A){return Ft(t)&&Ft(e)&&(A.set(e,t),Pn(t,e,h,Na,A),A.delete(e)),t}function Us(t){return an(t)?h:t}function Oa(t,e,r,o,a,A){var u=1&r,d=t.length,g=e.length;if(d!=g&&!(u&&g>d))return!1;var v=A.get(t),x=A.get(e);if(v&&x)return v==e&&x==t;var E=-1,P=!0,R=2&r?new ur:h;for(A.set(t,e),A.set(e,t);++E<d;){var G=t[E],k=e[E];if(o)var T=u?o(k,G,E,e,t,A):o(G,k,E,t,e,A);if(T!==h){if(T)continue;P=!1;break}if(R){if(!vi(e,(function(V,M){if(!Ur(R,M)&&(G===V||a(G,V,r,o,A)))return R.push(M)}))){P=!1;break}}else if(G!==k&&!a(G,k,r,o,A)){P=!1;break}}return A.delete(t),A.delete(e),P}function He(t){return ao(Ka(t,h,il),t+"")}function qi(t){return Aa(t,Gt,ro)}function $i(t){return Aa(t,le,Ha)}var to=Tn?function(t){return Tn.get(t)}:Bo;function Un(t){for(var e=t.name+"",r=zr[e],o=vt.call(zr,e)?r.length:0;o--;){var a=r[o],A=a.func;if(A==null||A==t)return a.name}return e}function Wr(t){return(vt.call(s,"placeholder")?s:t).placeholder}function J(){var t=s.iteratee||Co;return t=t===Co?pa:t,arguments.length?t(arguments[0],arguments[1]):t}function Gn(t,e){var r,o,a=t.__data__;return((o=typeof(r=e))=="string"||o=="number"||o=="symbol"||o=="boolean"?r!=="__proto__":r===null)?a[typeof e=="string"?"string":"hash"]:a.map}function eo(t){for(var e=Gt(t),r=e.length;r--;){var o=e[r],a=t[o];e[r]=[o,a,Ja(a)]}return e}function gr(t,e){var r=(function(o,a){return o==null?h:o[a]})(t,e);return ha(r)?r:h}var ro=Ei?function(t){return t==null?[]:(t=kt(t),Xe(Ei(t),(function(e){return Vo.call(t,e)})))}:vo,Ha=Ei?function(t){for(var e=[];t;)qe(e,ro(t)),t=kn(t);return e}:vo,qt=te;function Ua(t,e,r){for(var o=-1,a=(e=nr(e,t)).length,A=!1;++o<a;){var u=Qe(e[o]);if(!(A=t!=null&&r(t,u)))break;t=t[u]}return A||++o!=a?A:!!(a=t==null?0:t.length)&&$n(a)&&Ue(u,a)&&(nt(t)||Cr(t))}function Ga(t){return typeof t.constructor!="function"||nn(t)?{}:Er(kn(t))}function Gs(t){return nt(t)||Cr(t)||!!(Xo&&t&&t[Xo])}function Ue(t,e){var r=typeof t;return!!(e=e??Q)&&(r=="number"||r!="symbol"&&gi.test(t))&&t>-1&&t%1==0&&t<e}function ee(t,e,r){if(!Ft(r))return!1;var o=typeof e;return!!(o=="number"?ae(r)&&Ue(e,r.length):o=="string"&&e in r)&&ze(r[e],t)}function no(t,e){if(nt(t))return!1;var r=typeof t;return!(r!="number"&&r!="symbol"&&r!="boolean"&&t!=null&&!ue(t))||An.test(t)||!br.test(t)||e!=null&&t in kt(e)}function io(t){var e=Un(t),r=s[e];if(typeof r!="function"||!(e in ht.prototype))return!1;if(t===r)return!0;var o=to(r);return!!o&&t===o[0]}(Fi&&qt(new Fi(new ArrayBuffer(1)))!=Fe||Jr&&qt(new Jr)!=At||Ti&&qt(Ti.resolve())!=$t||Sr&&qt(new Sr)!=Mt||Zr&&qt(new Zr)!=Ae)&&(qt=function(t){var e=te(t),r=e==St?t.constructor:h,o=r?mr(r):"";if(o)switch(o){case ks:return Fe;case Ss:return At;case zs:return $t;case Es:return Mt;case Fs:return Ae}return e});var Js=vn?Ge:bo;function nn(t){var e=t&&t.constructor;return t===(typeof e=="function"&&e.prototype||kr)}function Ja(t){return t==t&&!Ft(t)}function Za(t,e){return function(r){return r!=null&&r[t]===e&&(e!==h||t in kt(r))}}function Ka(t,e,r){return e=Rt(e===h?t.length-1:e,0),function(){for(var o=arguments,a=-1,A=Rt(o.length-e,0),u=L(A);++a<A;)u[a]=o[e+a];a=-1;for(var d=L(e+1);++a<e;)d[a]=o[a];return d[e]=r(u),ce(t,this,d)}}function Va(t,e){return e.length<2?t:fr(t,be(e,0,-1))}function Zs(t,e){for(var r=t.length,o=Xt(e.length,r),a=oe(t);o--;){var A=e[o];t[o]=Ue(A,r)?a[A]:h}return t}function oo(t,e){if((e!=="constructor"||typeof t[e]!="function")&&e!="__proto__")return t[e]}var Xa=$a(Ba),on=ws||function(t,e){return Jt.setTimeout(t,e)},ao=$a(js);function qa(t,e,r){var o=e+"";return ao(t,(function(a,A){var u=A.length;if(!u)return a;var d=u-1;return A[d]=(u>1?"& ":"")+A[d],A=A.join(u>2?", ":" "),a.replace(hi,`{
/* [wrapped with `+A+`] */
`)})(o,(function(a,A){return Ce(b,(function(u){var d="_."+u[0];A&u[1]&&!gn(a,d)&&a.push(d)})),a.sort()})((function(a){var A=a.match(pi);return A?A[1].split(un):[]})(o),r)))}function $a(t){var e=0,r=0;return function(){var o=xs(),a=16-(o-r);if(r=o,a>0){if(++e>=800)return arguments[0]}else e=0;return t.apply(h,arguments)}}function Jn(t,e){var r=-1,o=t.length,a=o-1;for(e=e===h?o:e;++r<e;){var A=Ni(r,a),u=t[A];t[A]=t[r],t[r]=u}return t.length=e,t}var tl=(function(t){var e=Xn(t,(function(o){return r.size===500&&r.clear(),o})),r=e.cache;return e})((function(t){var e=[];return t.charCodeAt(0)===46&&e.push(""),t.replace(cn,(function(r,o,a,A){e.push(a?A.replace(Ar,"$1"):o||r)})),e}));function Qe(t){if(typeof t=="string"||ue(t))return t;var e=t+"";return e=="0"&&1/t==-1/0?"-0":e}function mr(t){if(t!=null){try{return bn.call(t)}catch{}try{return t+""}catch{}}return""}function el(t){if(t instanceof ht)return t.clone();var e=new Be(t.__wrapped__,t.__chain__);return e.__actions__=oe(t.__actions__),e.__index__=t.__index__,e.__values__=t.__values__,e}var Ks=st((function(t,e){return Qt(t)?qr(t,Zt(e,1,Qt,!0)):[]})),Vs=st((function(t,e){var r=xe(e);return Qt(r)&&(r=h),Qt(t)?qr(t,Zt(e,1,Qt,!0),J(r,2)):[]})),Xs=st((function(t,e){var r=xe(e);return Qt(r)&&(r=h),Qt(t)?qr(t,Zt(e,1,Qt,!0),h,r):[]}));function rl(t,e,r){var o=t==null?0:t.length;if(!o)return-1;var a=r==null?0:at(r);return a<0&&(a=Rt(o+a,0)),mn(t,J(e,3),a)}function nl(t,e,r){var o=t==null?0:t.length;if(!o)return-1;var a=o-1;return r!==h&&(a=at(r),a=r<0?Rt(o+a,0):Xt(a,o-1)),mn(t,J(e,3),a,!0)}function il(t){return t!=null&&t.length?Zt(t,1):[]}function ol(t){return t&&t.length?t[0]:h}var qs=st((function(t){var e=Et(t,Ji);return e.length&&e[0]===t[0]?Pi(e):[]})),$s=st((function(t){var e=xe(t),r=Et(t,Ji);return e===xe(r)?e=h:r.pop(),r.length&&r[0]===t[0]?Pi(r,J(e,2)):[]})),tA=st((function(t){var e=xe(t),r=Et(t,Ji);return(e=typeof e=="function"?e:h)&&r.pop(),r.length&&r[0]===t[0]?Pi(r,h,e):[]}));function xe(t){var e=t==null?0:t.length;return e?t[e-1]:h}var eA=st(al);function al(t,e){return t&&t.length&&e&&e.length?Ri(t,e):t}var rA=He((function(t,e){var r=t==null?0:t.length,o=Li(t,e);return wa(t,Et(e,(function(a){return Ue(a,r)?+a:a})).sort(Ea)),o}));function lo(t){return t==null?t:Is.call(t)}var nA=st((function(t){return rr(Zt(t,1,Qt,!0))})),iA=st((function(t){var e=xe(t);return Qt(e)&&(e=h),rr(Zt(t,1,Qt,!0),J(e,2))})),oA=st((function(t){var e=xe(t);return e=typeof e=="function"?e:h,rr(Zt(t,1,Qt,!0),h,e)}));function so(t){if(!t||!t.length)return[];var e=0;return t=Xe(t,(function(r){if(Qt(r))return e=Rt(r.length,e),!0})),Ii(e,(function(r){return Et(t,bi(r))}))}function ll(t,e){if(!t||!t.length)return[];var r=so(t);return e==null?r:Et(r,(function(o){return ce(e,h,o)}))}var aA=st((function(t,e){return Qt(t)?qr(t,e):[]})),lA=st((function(t){return Gi(Xe(t,Qt))})),sA=st((function(t){var e=xe(t);return Qt(e)&&(e=h),Gi(Xe(t,Qt),J(e,2))})),AA=st((function(t){var e=xe(t);return e=typeof e=="function"?e:h,Gi(Xe(t,Qt),h,e)})),cA=st(so),hA=st((function(t){var e=t.length,r=e>1?t[e-1]:h;return r=typeof r=="function"?(t.pop(),r):h,ll(t,r)}));function sl(t){var e=s(t);return e.__chain__=!0,e}function Zn(t,e){return e(t)}var pA=He((function(t){var e=t.length,r=e?t[0]:0,o=this.__wrapped__,a=function(A){return Li(A,t)};return!(e>1||this.__actions__.length)&&o instanceof ht&&Ue(r)?((o=o.slice(r,+r+(e?1:0))).__actions__.push({func:Zn,args:[a],thisArg:h}),new Be(o,this.__chain__).thru((function(A){return e&&!A.length&&A.push(h),A}))):this.thru(a)})),uA=jn((function(t,e,r){vt.call(t,r)?++t[r]:Ne(t,r,1)})),dA=Ma(rl),fA=Ma(nl);function Al(t,e){return(nt(t)?Ce:er)(t,J(e,3))}function cl(t,e){return(nt(t)?es:aa)(t,J(e,3))}var gA=jn((function(t,e,r){vt.call(t,r)?t[r].push(e):Ne(t,r,[e])})),mA=st((function(t,e,r){var o=-1,a=typeof e=="function",A=ae(t)?L(t.length):[];return er(t,(function(u){A[++o]=a?ce(e,u,r):$r(u,e,r)})),A})),CA=jn((function(t,e,r){Ne(t,r,e)}));function Kn(t,e){return(nt(t)?Et:ua)(t,J(e,3))}var wA=jn((function(t,e,r){t[r?0:1].push(e)}),(function(){return[[],[]]})),BA=st((function(t,e){if(t==null)return[];var r=e.length;return r>1&&ee(t,e[0],e[1])?e=[]:r>2&&ee(e[0],e[1],e[2])&&(e=[e[0]]),ma(t,Zt(e,1),[])})),Vn=Cs||function(){return Jt.Date.now()};function hl(t,e,r){return e=r?h:e,e=t&&e==null?t.length:e,Oe(t,dt,h,h,h,h,e)}function pl(t,e){var r;if(typeof e!="function")throw new we(U);return t=at(t),function(){return--t>0&&(r=e.apply(this,arguments)),t<=1&&(e=h),r}}var Ao=st((function(t,e,r){var o=1;if(r.length){var a=$e(r,Wr(Ao));o|=pt}return Oe(t,o,e,r,a)})),ul=st((function(t,e,r){var o=3;if(r.length){var a=$e(r,Wr(ul));o|=pt}return Oe(e,o,t,r,a)}));function dl(t,e,r){var o,a,A,u,d,g,v=0,x=!1,E=!1,P=!0;if(typeof t!="function")throw new we(U);function R(X){var q=o,ct=a;return o=a=h,v=X,u=t.apply(ct,q)}function G(X){return v=X,d=on(T,e),x?R(X):u}function k(X){var q=X-g;return g===h||q>=e||q<0||E&&X-v>=A}function T(){var X=Vn();if(k(X))return V(X);d=on(T,(function(q){var ct=e-(q-g);return E?Xt(ct,A-(q-v)):ct})(X))}function V(X){return d=h,P&&o?R(X):(o=a=h,u)}function M(){var X=Vn(),q=k(X);if(o=arguments,a=this,g=X,q){if(d===h)return G(g);if(E)return ka(d),d=on(T,e),R(g)}return d===h&&(d=on(T,e)),u}return e=ye(e)||0,Ft(r)&&(x=!!r.leading,A=(E="maxWait"in r)?Rt(ye(r.maxWait)||0,e):A,P="trailing"in r?!!r.trailing:P),M.cancel=function(){d!==h&&ka(d),v=0,o=g=a=d=h},M.flush=function(){return d===h?u:V(Vn())},M}var vA=st((function(t,e){return oa(t,1,e)})),bA=st((function(t,e,r){return oa(t,ye(e)||0,r)}));function Xn(t,e){if(typeof t!="function"||e!=null&&typeof e!="function")throw new we(U);var r=function(){var o=arguments,a=e?e.apply(this,o):o[0],A=r.cache;if(A.has(a))return A.get(a);var u=t.apply(this,o);return r.cache=A.set(a,u)||A,u};return r.cache=new(Xn.Cache||Re),r}function qn(t){if(typeof t!="function")throw new we(U);return function(){var e=arguments;switch(e.length){case 0:return!t.call(this);case 1:return!t.call(this,e[0]);case 2:return!t.call(this,e[0],e[1]);case 3:return!t.call(this,e[0],e[1],e[2])}return!t.apply(this,e)}}Xn.Cache=Re;var xA=Os((function(t,e){var r=(e=e.length==1&&nt(e[0])?Et(e[0],he(J())):Et(Zt(e,1),he(J()))).length;return st((function(o){for(var a=-1,A=Xt(o.length,r);++a<A;)o[a]=e[a].call(this,o[a]);return ce(t,this,o)}))})),co=st((function(t,e){var r=$e(e,Wr(co));return Oe(t,pt,h,e,r)})),fl=st((function(t,e){var r=$e(e,Wr(fl));return Oe(t,ut,h,e,r)})),yA=He((function(t,e){return Oe(t,_t,h,h,h,e)}));function ze(t,e){return t===e||t!=t&&e!=e}var IA=Hn(Di),kA=Hn((function(t,e){return t>=e})),Cr=ca((function(){return arguments})())?ca:function(t){return Wt(t)&&vt.call(t,"callee")&&!Vo.call(t,"callee")},nt=L.isArray,SA=Lo?he(Lo):function(t){return Wt(t)&&te(t)==Ee};function ae(t){return t!=null&&$n(t.length)&&!Ge(t)}function Qt(t){return Wt(t)&&ae(t)}var or=Bs||bo,zA=Qo?he(Qo):function(t){return Wt(t)&&te(t)==Z};function ho(t){if(!Wt(t))return!1;var e=te(t);return e==rt||e=="[object DOMException]"||typeof t.message=="string"&&typeof t.name=="string"&&!an(t)}function Ge(t){if(!Ft(t))return!1;var e=te(t);return e==lt||e==gt||e=="[object AsyncFunction]"||e=="[object Proxy]"}function gl(t){return typeof t=="number"&&t==at(t)}function $n(t){return typeof t=="number"&&t>-1&&t%1==0&&t<=Q}function Ft(t){var e=typeof t;return t!=null&&(e=="object"||e=="function")}function Wt(t){return t!=null&&typeof t=="object"}var ml=Mo?he(Mo):function(t){return Wt(t)&&qt(t)==At};function Cl(t){return typeof t=="number"||Wt(t)&&te(t)==Lt}function an(t){if(!Wt(t)||te(t)!=St)return!1;var e=kn(t);if(e===null)return!0;var r=vt.call(e,"constructor")&&e.constructor;return typeof r=="function"&&r instanceof r&&bn.call(r)==ds}var po=Do?he(Do):function(t){return Wt(t)&&te(t)==ne},wl=Po?he(Po):function(t){return Wt(t)&&qt(t)==Mt};function ti(t){return typeof t=="string"||!nt(t)&&Wt(t)&&te(t)==mt}function ue(t){return typeof t=="symbol"||Wt(t)&&te(t)==fe}var Lr=_o?he(_o):function(t){return Wt(t)&&$n(t.length)&&!!It[te(t)]},EA=Hn(ji),FA=Hn((function(t,e){return t<=e}));function Bl(t){if(!t)return[];if(ae(t))return ti(t)?ke(t):oe(t);if(Gr&&t[Gr])return(function(r){for(var o,a=[];!(o=r.next()).done;)a.push(o.value);return a})(t[Gr]());var e=qt(t);return(e==At?Si:e==Mt?Cn:Qr)(t)}function Je(t){return t?(t=ye(t))===H||t===-1/0?17976931348623157e292*(t<0?-1:1):t==t?t:0:t===0?t:0}function at(t){var e=Je(t),r=e%1;return e==e?r?e-r:e:0}function vl(t){return t?dr(at(t),0,F):0}function ye(t){if(typeof t=="number")return t;if(ue(t))return D;if(Ft(t)){var e=typeof t.valueOf=="function"?t.valueOf():t;t=Ft(e)?e+"":e}if(typeof t!="string")return t===0?t:+t;t=t.replace(Kt,"");var r=fn.test(t);return r||fi.test(t)?ql(t.slice(2),r?2:8):ui.test(t)?D:+t}function bl(t){return Le(t,le(t))}function wt(t){return t==null?"":pe(t)}var TA=Fr((function(t,e){if(nn(e)||ae(e))Le(e,Gt(e),t);else for(var r in e)vt.call(e,r)&&Xr(t,r,e[r])})),xl=Fr((function(t,e){Le(e,le(e),t)})),ei=Fr((function(t,e,r,o){Le(e,le(e),t,o)})),WA=Fr((function(t,e,r,o){Le(e,Gt(e),t,o)})),LA=He(Li),QA=st((function(t,e){t=kt(t);var r=-1,o=e.length,a=o>2?e[2]:h;for(a&&ee(e[0],e[1],a)&&(o=1);++r<o;)for(var A=e[r],u=le(A),d=-1,g=u.length;++d<g;){var v=u[d],x=t[v];(x===h||ze(x,kr[v])&&!vt.call(t,v))&&(t[v]=A[v])}return t})),MA=st((function(t){return t.push(h,Na),ce(yl,h,t)}));function uo(t,e,r){var o=t==null?h:fr(t,e);return o===h?r:o}function fo(t,e){return t!=null&&Ua(t,e,Ds)}var DA=Pa((function(t,e,r){e!=null&&typeof e.toString!="function"&&(e=xn.call(e)),t[e]=r}),mo(se)),PA=Pa((function(t,e,r){e!=null&&typeof e.toString!="function"&&(e=xn.call(e)),vt.call(t,e)?t[e].push(r):t[e]=[r]}),J),_A=st($r);function Gt(t){return ae(t)?ea(t):Yi(t)}function le(t){return ae(t)?ea(t,!0):Ps(t)}var YA=Fr((function(t,e,r){Pn(t,e,r)})),yl=Fr((function(t,e,r,o){Pn(t,e,r,o)})),jA=He((function(t,e){var r={};if(t==null)return r;var o=!1;e=Et(e,(function(A){return A=nr(A,t),o||(o=A.length>1),A})),Le(t,$i(t),r),o&&(r=ve(r,7,Us));for(var a=e.length;a--;)Ui(r,e[a]);return r})),RA=He((function(t,e){return t==null?{}:(function(r,o){return Ca(r,o,(function(a,A){return fo(r,A)}))})(t,e)}));function Il(t,e){if(t==null)return{};var r=Et($i(t),(function(o){return[o]}));return e=J(e),Ca(t,r,(function(o,a){return e(o,a[0])}))}var kl=ja(Gt),Sl=ja(le);function Qr(t){return t==null?[]:ki(t,Gt(t))}var NA=Tr((function(t,e,r){return e=e.toLowerCase(),t+(r?zl(e):e)}));function zl(t){return go(wt(t).toLowerCase())}function El(t){return(t=wt(t))&&t.replace(j,as).replace(Hl,"")}var OA=Tr((function(t,e,r){return t+(r?"-":"")+e.toLowerCase()})),HA=Tr((function(t,e,r){return t+(r?" ":"")+e.toLowerCase()})),UA=Qa("toLowerCase"),GA=Tr((function(t,e,r){return t+(r?"_":"")+e.toLowerCase()})),JA=Tr((function(t,e,r){return t+(r?" ":"")+go(e)})),ZA=Tr((function(t,e,r){return t+(r?" ":"")+e.toUpperCase()})),go=Qa("toUpperCase");function Fl(t,e,r){return t=wt(t),(e=r?h:e)===h?(function(o){return Jl.test(o)})(t)?(function(o){return o.match(Ul)||[]})(t):(function(o){return o.match(Ye)||[]})(t):t.match(e)||[]}var Tl=st((function(t,e){try{return ce(t,h,e)}catch(r){return ho(r)?r:new ft(r)}})),KA=He((function(t,e){return Ce(e,(function(r){r=Qe(r),Ne(t,r,Ao(t[r],t))})),t}));function mo(t){return function(){return t}}var VA=Da(),XA=Da(!0);function se(t){return t}function Co(t){return pa(typeof t=="function"?t:ve(t,1))}var qA=st((function(t,e){return function(r){return $r(r,t,e)}})),$A=st((function(t,e){return function(r){return $r(t,r,e)}}));function wo(t,e,r){var o=Gt(e),a=Dn(e,o);r!=null||Ft(e)&&(a.length||!o.length)||(r=e,e=t,t=this,a=Dn(e,Gt(e)));var A=!(Ft(r)&&"chain"in r&&!r.chain),u=Ge(t);return Ce(a,(function(d){var g=e[d];t[d]=g,u&&(t.prototype[d]=function(){var v=this.__chain__;if(A||v){var x=t(this.__wrapped__),E=x.__actions__=oe(this.__actions__);return E.push({func:g,args:arguments,thisArg:t}),x.__chain__=v,x}return g.apply(t,qe([this.value()],arguments))})})),t}function Bo(){}var tc=Vi(Et),ec=Vi(Yo),rc=Vi(vi);function Wl(t){return no(t)?bi(Qe(t)):(function(e){return function(r){return fr(r,e)}})(t)}var nc=_a(),ic=_a(!0);function vo(){return[]}function bo(){return!1}var oc=Nn((function(t,e){return t+e}),0),ac=Xi("ceil"),lc=Nn((function(t,e){return t/e}),1),sc=Xi("floor"),xo,Ac=Nn((function(t,e){return t*e}),1),cc=Xi("round"),hc=Nn((function(t,e){return t-e}),0);return s.after=function(t,e){if(typeof e!="function")throw new we(U);return t=at(t),function(){if(--t<1)return e.apply(this,arguments)}},s.ary=hl,s.assign=TA,s.assignIn=xl,s.assignInWith=ei,s.assignWith=WA,s.at=LA,s.before=pl,s.bind=Ao,s.bindAll=KA,s.bindKey=ul,s.castArray=function(){if(!arguments.length)return[];var t=arguments[0];return nt(t)?t:[t]},s.chain=sl,s.chunk=function(t,e,r){e=(r?ee(t,e,r):e===h)?1:Rt(at(e),0);var o=t==null?0:t.length;if(!o||e<1)return[];for(var a=0,A=0,u=L(En(o/e));a<o;)u[A++]=be(t,a,a+=e);return u},s.compact=function(t){for(var e=-1,r=t==null?0:t.length,o=0,a=[];++e<r;){var A=t[e];A&&(a[o++]=A)}return a},s.concat=function(){var t=arguments.length;if(!t)return[];for(var e=L(t-1),r=arguments[0],o=t;o--;)e[o-1]=arguments[o];return qe(nt(r)?oe(r):[r],Zt(e,1))},s.cond=function(t){var e=t==null?0:t.length,r=J();return t=e?Et(t,(function(o){if(typeof o[1]!="function")throw new we(U);return[r(o[0]),o[1]]})):[],st((function(o){for(var a=-1;++a<e;){var A=t[a];if(ce(A[0],this,o))return ce(A[1],this,o)}}))},s.conforms=function(t){return(function(e){var r=Gt(e);return function(o){return ia(o,e,r)}})(ve(t,1))},s.constant=mo,s.countBy=uA,s.create=function(t,e){var r=Er(t);return e==null?r:na(r,e)},s.curry=function t(e,r,o){var a=Oe(e,8,h,h,h,h,h,r=o?h:r);return a.placeholder=t.placeholder,a},s.curryRight=function t(e,r,o){var a=Oe(e,bt,h,h,h,h,h,r=o?h:r);return a.placeholder=t.placeholder,a},s.debounce=dl,s.defaults=QA,s.defaultsDeep=MA,s.defer=vA,s.delay=bA,s.difference=Ks,s.differenceBy=Vs,s.differenceWith=Xs,s.drop=function(t,e,r){var o=t==null?0:t.length;return o?be(t,(e=r||e===h?1:at(e))<0?0:e,o):[]},s.dropRight=function(t,e,r){var o=t==null?0:t.length;return o?be(t,0,(e=o-(e=r||e===h?1:at(e)))<0?0:e):[]},s.dropRightWhile=function(t,e){return t&&t.length?Yn(t,J(e,3),!0,!0):[]},s.dropWhile=function(t,e){return t&&t.length?Yn(t,J(e,3),!0):[]},s.fill=function(t,e,r,o){var a=t==null?0:t.length;return a?(r&&typeof r!="number"&&ee(t,e,r)&&(r=0,o=a),(function(A,u,d,g){var v=A.length;for((d=at(d))<0&&(d=-d>v?0:v+d),(g=g===h||g>v?v:at(g))<0&&(g+=v),g=d>g?0:vl(g);d<g;)A[d++]=u;return A})(t,e,r,o)):[]},s.filter=function(t,e){return(nt(t)?Xe:la)(t,J(e,3))},s.flatMap=function(t,e){return Zt(Kn(t,e),1)},s.flatMapDeep=function(t,e){return Zt(Kn(t,e),H)},s.flatMapDepth=function(t,e,r){return r=r===h?1:at(r),Zt(Kn(t,e),r)},s.flatten=il,s.flattenDeep=function(t){return t!=null&&t.length?Zt(t,H):[]},s.flattenDepth=function(t,e){return t!=null&&t.length?Zt(t,e=e===h?1:at(e)):[]},s.flip=function(t){return Oe(t,512)},s.flow=VA,s.flowRight=XA,s.fromPairs=function(t){for(var e=-1,r=t==null?0:t.length,o={};++e<r;){var a=t[e];o[a[0]]=a[1]}return o},s.functions=function(t){return t==null?[]:Dn(t,Gt(t))},s.functionsIn=function(t){return t==null?[]:Dn(t,le(t))},s.groupBy=gA,s.initial=function(t){return t!=null&&t.length?be(t,0,-1):[]},s.intersection=qs,s.intersectionBy=$s,s.intersectionWith=tA,s.invert=DA,s.invertBy=PA,s.invokeMap=mA,s.iteratee=Co,s.keyBy=CA,s.keys=Gt,s.keysIn=le,s.map=Kn,s.mapKeys=function(t,e){var r={};return e=J(e,3),We(t,(function(o,a,A){Ne(r,e(o,a,A),o)})),r},s.mapValues=function(t,e){var r={};return e=J(e,3),We(t,(function(o,a,A){Ne(r,a,e(o,a,A))})),r},s.matches=function(t){return da(ve(t,1))},s.matchesProperty=function(t,e){return fa(t,ve(e,1))},s.memoize=Xn,s.merge=YA,s.mergeWith=yl,s.method=qA,s.methodOf=$A,s.mixin=wo,s.negate=qn,s.nthArg=function(t){return t=at(t),st((function(e){return ga(e,t)}))},s.omit=jA,s.omitBy=function(t,e){return Il(t,qn(J(e)))},s.once=function(t){return pl(2,t)},s.orderBy=function(t,e,r,o){return t==null?[]:(nt(e)||(e=e==null?[]:[e]),nt(r=o?h:r)||(r=r==null?[]:[r]),ma(t,e,r))},s.over=tc,s.overArgs=xA,s.overEvery=ec,s.overSome=rc,s.partial=co,s.partialRight=fl,s.partition=wA,s.pick=RA,s.pickBy=Il,s.property=Wl,s.propertyOf=function(t){return function(e){return t==null?h:fr(t,e)}},s.pull=eA,s.pullAll=al,s.pullAllBy=function(t,e,r){return t&&t.length&&e&&e.length?Ri(t,e,J(r,2)):t},s.pullAllWith=function(t,e,r){return t&&t.length&&e&&e.length?Ri(t,e,h,r):t},s.pullAt=rA,s.range=nc,s.rangeRight=ic,s.rearg=yA,s.reject=function(t,e){return(nt(t)?Xe:la)(t,qn(J(e,3)))},s.remove=function(t,e){var r=[];if(!t||!t.length)return r;var o=-1,a=[],A=t.length;for(e=J(e,3);++o<A;){var u=t[o];e(u,o,t)&&(r.push(u),a.push(o))}return wa(t,a),r},s.rest=function(t,e){if(typeof t!="function")throw new we(U);return st(t,e=e===h?e:at(e))},s.reverse=lo,s.sampleSize=function(t,e,r){return e=(r?ee(t,e,r):e===h)?1:at(e),(nt(t)?Ts:Ys)(t,e)},s.set=function(t,e,r){return t==null?t:en(t,e,r)},s.setWith=function(t,e,r,o){return o=typeof o=="function"?o:h,t==null?t:en(t,e,r,o)},s.shuffle=function(t){return(nt(t)?Ws:Rs)(t)},s.slice=function(t,e,r){var o=t==null?0:t.length;return o?(r&&typeof r!="number"&&ee(t,e,r)?(e=0,r=o):(e=e==null?0:at(e),r=r===h?o:at(r)),be(t,e,r)):[]},s.sortBy=BA,s.sortedUniq=function(t){return t&&t.length?va(t):[]},s.sortedUniqBy=function(t,e){return t&&t.length?va(t,J(e,2)):[]},s.split=function(t,e,r){return r&&typeof r!="number"&&ee(t,e,r)&&(e=r=h),(r=r===h?F:r>>>0)?(t=wt(t))&&(typeof e=="string"||e!=null&&!po(e))&&!(e=pe(e))&&yr(t)?ir(ke(t),0,r):t.split(e,r):[]},s.spread=function(t,e){if(typeof t!="function")throw new we(U);return e=e==null?0:Rt(at(e),0),st((function(r){var o=r[e],a=ir(r,0,e);return o&&qe(a,o),ce(t,this,a)}))},s.tail=function(t){var e=t==null?0:t.length;return e?be(t,1,e):[]},s.take=function(t,e,r){return t&&t.length?be(t,0,(e=r||e===h?1:at(e))<0?0:e):[]},s.takeRight=function(t,e,r){var o=t==null?0:t.length;return o?be(t,(e=o-(e=r||e===h?1:at(e)))<0?0:e,o):[]},s.takeRightWhile=function(t,e){return t&&t.length?Yn(t,J(e,3),!1,!0):[]},s.takeWhile=function(t,e){return t&&t.length?Yn(t,J(e,3)):[]},s.tap=function(t,e){return e(t),t},s.throttle=function(t,e,r){var o=!0,a=!0;if(typeof t!="function")throw new we(U);return Ft(r)&&(o="leading"in r?!!r.leading:o,a="trailing"in r?!!r.trailing:a),dl(t,e,{leading:o,maxWait:e,trailing:a})},s.thru=Zn,s.toArray=Bl,s.toPairs=kl,s.toPairsIn=Sl,s.toPath=function(t){return nt(t)?Et(t,Qe):ue(t)?[t]:oe(tl(wt(t)))},s.toPlainObject=bl,s.transform=function(t,e,r){var o=nt(t),a=o||or(t)||Lr(t);if(e=J(e,4),r==null){var A=t&&t.constructor;r=a?o?new A:[]:Ft(t)&&Ge(A)?Er(kn(t)):{}}return(a?Ce:We)(t,(function(u,d,g){return e(r,u,d,g)})),r},s.unary=function(t){return hl(t,1)},s.union=nA,s.unionBy=iA,s.unionWith=oA,s.uniq=function(t){return t&&t.length?rr(t):[]},s.uniqBy=function(t,e){return t&&t.length?rr(t,J(e,2)):[]},s.uniqWith=function(t,e){return e=typeof e=="function"?e:h,t&&t.length?rr(t,h,e):[]},s.unset=function(t,e){return t==null||Ui(t,e)},s.unzip=so,s.unzipWith=ll,s.update=function(t,e,r){return t==null?t:xa(t,e,Zi(r))},s.updateWith=function(t,e,r,o){return o=typeof o=="function"?o:h,t==null?t:xa(t,e,Zi(r),o)},s.values=Qr,s.valuesIn=function(t){return t==null?[]:ki(t,le(t))},s.without=aA,s.words=Fl,s.wrap=function(t,e){return co(Zi(e),t)},s.xor=lA,s.xorBy=sA,s.xorWith=AA,s.zip=cA,s.zipObject=function(t,e){return Ia(t||[],e||[],Xr)},s.zipObjectDeep=function(t,e){return Ia(t||[],e||[],en)},s.zipWith=hA,s.entries=kl,s.entriesIn=Sl,s.extend=xl,s.extendWith=ei,wo(s,s),s.add=oc,s.attempt=Tl,s.camelCase=NA,s.capitalize=zl,s.ceil=ac,s.clamp=function(t,e,r){return r===h&&(r=e,e=h),r!==h&&(r=(r=ye(r))==r?r:0),e!==h&&(e=(e=ye(e))==e?e:0),dr(ye(t),e,r)},s.clone=function(t){return ve(t,4)},s.cloneDeep=function(t){return ve(t,5)},s.cloneDeepWith=function(t,e){return ve(t,5,e=typeof e=="function"?e:h)},s.cloneWith=function(t,e){return ve(t,4,e=typeof e=="function"?e:h)},s.conformsTo=function(t,e){return e==null||ia(t,e,Gt(e))},s.deburr=El,s.defaultTo=function(t,e){return t==null||t!=t?e:t},s.divide=lc,s.endsWith=function(t,e,r){t=wt(t),e=pe(e);var o=t.length,a=r=r===h?o:dr(at(r),0,o);return(r-=e.length)>=0&&t.slice(r,a)==e},s.eq=ze,s.escape=function(t){return(t=wt(t))&&Ct.test(t)?t.replace(Br,ls):t},s.escapeRegExp=function(t){return(t=wt(t))&&Dt.test(t)?t.replace(xt,"\\$&"):t},s.every=function(t,e,r){var o=nt(t)?Yo:Qs;return r&&ee(t,e,r)&&(e=h),o(t,J(e,3))},s.find=dA,s.findIndex=rl,s.findKey=function(t,e){return jo(t,J(e,3),We)},s.findLast=fA,s.findLastIndex=nl,s.findLastKey=function(t,e){return jo(t,J(e,3),Mi)},s.floor=sc,s.forEach=Al,s.forEachRight=cl,s.forIn=function(t,e){return t==null?t:Qi(t,J(e,3),le)},s.forInRight=function(t,e){return t==null?t:sa(t,J(e,3),le)},s.forOwn=function(t,e){return t&&We(t,J(e,3))},s.forOwnRight=function(t,e){return t&&Mi(t,J(e,3))},s.get=uo,s.gt=IA,s.gte=kA,s.has=function(t,e){return t!=null&&Ua(t,e,Ms)},s.hasIn=fo,s.head=ol,s.identity=se,s.includes=function(t,e,r,o){t=ae(t)?t:Qr(t),r=r&&!o?at(r):0;var a=t.length;return r<0&&(r=Rt(a+r,0)),ti(t)?r<=a&&t.indexOf(e,r)>-1:!!a&&xr(t,e,r)>-1},s.indexOf=function(t,e,r){var o=t==null?0:t.length;if(!o)return-1;var a=r==null?0:at(r);return a<0&&(a=Rt(o+a,0)),xr(t,e,a)},s.inRange=function(t,e,r){return e=Je(e),r===h?(r=e,e=0):r=Je(r),(function(o,a,A){return o>=Xt(a,A)&&o<Rt(a,A)})(t=ye(t),e,r)},s.invoke=_A,s.isArguments=Cr,s.isArray=nt,s.isArrayBuffer=SA,s.isArrayLike=ae,s.isArrayLikeObject=Qt,s.isBoolean=function(t){return t===!0||t===!1||Wt(t)&&te(t)==Y},s.isBuffer=or,s.isDate=zA,s.isElement=function(t){return Wt(t)&&t.nodeType===1&&!an(t)},s.isEmpty=function(t){if(t==null)return!0;if(ae(t)&&(nt(t)||typeof t=="string"||typeof t.splice=="function"||or(t)||Lr(t)||Cr(t)))return!t.length;var e=qt(t);if(e==At||e==Mt)return!t.size;if(nn(t))return!Yi(t).length;for(var r in t)if(vt.call(t,r))return!1;return!0},s.isEqual=function(t,e){return tn(t,e)},s.isEqualWith=function(t,e,r){var o=(r=typeof r=="function"?r:h)?r(t,e):h;return o===h?tn(t,e,h,r):!!o},s.isError=ho,s.isFinite=function(t){return typeof t=="number"&&qo(t)},s.isFunction=Ge,s.isInteger=gl,s.isLength=$n,s.isMap=ml,s.isMatch=function(t,e){return t===e||_i(t,e,eo(e))},s.isMatchWith=function(t,e,r){return r=typeof r=="function"?r:h,_i(t,e,eo(e),r)},s.isNaN=function(t){return Cl(t)&&t!=+t},s.isNative=function(t){if(Js(t))throw new ft("Unsupported core-js use. Try https://npms.io/search?q=ponyfill.");return ha(t)},s.isNil=function(t){return t==null},s.isNull=function(t){return t===null},s.isNumber=Cl,s.isObject=Ft,s.isObjectLike=Wt,s.isPlainObject=an,s.isRegExp=po,s.isSafeInteger=function(t){return gl(t)&&t>=-9007199254740991&&t<=Q},s.isSet=wl,s.isString=ti,s.isSymbol=ue,s.isTypedArray=Lr,s.isUndefined=function(t){return t===h},s.isWeakMap=function(t){return Wt(t)&&qt(t)==Ae},s.isWeakSet=function(t){return Wt(t)&&te(t)=="[object WeakSet]"},s.join=function(t,e){return t==null?"":vs.call(t,e)},s.kebabCase=OA,s.last=xe,s.lastIndexOf=function(t,e,r){var o=t==null?0:t.length;if(!o)return-1;var a=o;return r!==h&&(a=(a=at(r))<0?Rt(o+a,0):Xt(a,o-1)),e==e?(function(A,u,d){for(var g=d+1;g--;)if(A[g]===u)return g;return g})(t,e,a):mn(t,Ro,a,!0)},s.lowerCase=HA,s.lowerFirst=UA,s.lt=EA,s.lte=FA,s.max=function(t){return t&&t.length?Mn(t,se,Di):h},s.maxBy=function(t,e){return t&&t.length?Mn(t,J(e,2),Di):h},s.mean=function(t){return No(t,se)},s.meanBy=function(t,e){return No(t,J(e,2))},s.min=function(t){return t&&t.length?Mn(t,se,ji):h},s.minBy=function(t,e){return t&&t.length?Mn(t,J(e,2),ji):h},s.stubArray=vo,s.stubFalse=bo,s.stubObject=function(){return{}},s.stubString=function(){return""},s.stubTrue=function(){return!0},s.multiply=Ac,s.nth=function(t,e){return t&&t.length?ga(t,at(e)):h},s.noConflict=function(){return Jt._===this&&(Jt._=fs),this},s.noop=Bo,s.now=Vn,s.pad=function(t,e,r){t=wt(t);var o=(e=at(e))?Ir(t):0;if(!e||o>=e)return t;var a=(e-o)/2;return On(Fn(a),r)+t+On(En(a),r)},s.padEnd=function(t,e,r){t=wt(t);var o=(e=at(e))?Ir(t):0;return e&&o<e?t+On(e-o,r):t},s.padStart=function(t,e,r){t=wt(t);var o=(e=at(e))?Ir(t):0;return e&&o<e?On(e-o,r)+t:t},s.parseInt=function(t,e,r){return r||e==null?e=0:e&&(e=+e),ys(wt(t).replace(hn,""),e||0)},s.random=function(t,e,r){if(r&&typeof r!="boolean"&&ee(t,e,r)&&(e=r=h),r===h&&(typeof e=="boolean"?(r=e,e=h):typeof t=="boolean"&&(r=t,t=h)),t===h&&e===h?(t=0,e=1):(t=Je(t),e===h?(e=t,t=0):e=Je(e)),t>e){var o=t;t=e,e=o}if(r||t%1||e%1){var a=$o();return Xt(t+a*(e-t+Xl("1e-"+((a+"").length-1))),e)}return Ni(t,e)},s.reduce=function(t,e,r){var o=nt(t)?Bi:Oo,a=arguments.length<3;return o(t,J(e,4),r,a,er)},s.reduceRight=function(t,e,r){var o=nt(t)?rs:Oo,a=arguments.length<3;return o(t,J(e,4),r,a,aa)},s.repeat=function(t,e,r){return e=(r?ee(t,e,r):e===h)?1:at(e),Oi(wt(t),e)},s.replace=function(){var t=arguments,e=wt(t[0]);return t.length<3?e:e.replace(t[1],t[2])},s.result=function(t,e,r){var o=-1,a=(e=nr(e,t)).length;for(a||(a=1,t=h);++o<a;){var A=t==null?h:t[Qe(e[o])];A===h&&(o=a,A=r),t=Ge(A)?A.call(t):A}return t},s.round=cc,s.runInContext=m,s.sample=function(t){return(nt(t)?ra:_s)(t)},s.size=function(t){if(t==null)return 0;if(ae(t))return ti(t)?Ir(t):t.length;var e=qt(t);return e==At||e==Mt?t.size:Yi(t).length},s.snakeCase=GA,s.some=function(t,e,r){var o=nt(t)?vi:Ns;return r&&ee(t,e,r)&&(e=h),o(t,J(e,3))},s.sortedIndex=function(t,e){return _n(t,e)},s.sortedIndexBy=function(t,e,r){return Hi(t,e,J(r,2))},s.sortedIndexOf=function(t,e){var r=t==null?0:t.length;if(r){var o=_n(t,e);if(o<r&&ze(t[o],e))return o}return-1},s.sortedLastIndex=function(t,e){return _n(t,e,!0)},s.sortedLastIndexBy=function(t,e,r){return Hi(t,e,J(r,2),!0)},s.sortedLastIndexOf=function(t,e){if(t!=null&&t.length){var r=_n(t,e,!0)-1;if(ze(t[r],e))return r}return-1},s.startCase=JA,s.startsWith=function(t,e,r){return t=wt(t),r=r==null?0:dr(at(r),0,t.length),e=pe(e),t.slice(r,r+e.length)==e},s.subtract=hc,s.sum=function(t){return t&&t.length?yi(t,se):0},s.sumBy=function(t,e){return t&&t.length?yi(t,J(e,2)):0},s.template=function(t,e,r){var o=s.templateSettings;r&&ee(t,e,r)&&(e=h),t=wt(t),e=ei({},e,o,Ra);var a,A,u=ei({},e.imports,o.imports,Ra),d=Gt(u),g=ki(u,d),v=0,x=e.interpolate||n,E="__p += '",P=zi((e.escape||n).source+"|"+x.source+"|"+(x===vr?dn:n).source+"|"+(e.evaluate||n).source+"|$","g"),R="//# sourceURL="+(vt.call(e,"sourceURL")?(e.sourceURL+"").replace(/\s/g," "):"lodash.templateSources["+ ++Kl+"]")+`
`;t.replace(P,(function(T,V,M,X,q,ct){return M||(M=X),E+=t.slice(v,ct).replace(i,ss),V&&(a=!0,E+=`' +
__e(`+V+`) +
'`),q&&(A=!0,E+=`';
`+q+`;
__p += '`),M&&(E+=`' +
((__t = (`+M+`)) == null ? '' : __t) +
'`),v=ct+T.length,T})),E+=`';
`;var G=vt.call(e,"variable")&&e.variable;G||(E=`with (obj) {
`+E+`
}
`),E=(A?E.replace(si,""):E).replace(Ai,"$1").replace(ci,"$1;"),E="function("+(G||"obj")+`) {
`+(G?"":`obj || (obj = {});
`)+"var __t, __p = ''"+(a?", __e = _.escape":"")+(A?`, __j = Array.prototype.join;
function print() { __p += __j.call(arguments, '') }
`:`;
`)+E+`return __p
}`;var k=Tl((function(){return jt(d,R+"return "+E).apply(h,g)}));if(k.source=E,ho(k))throw k;return k},s.times=function(t,e){if((t=at(t))<1||t>Q)return[];var r=F,o=Xt(t,F);e=J(e),t-=F;for(var a=Ii(o,e);++r<t;)e(r);return a},s.toFinite=Je,s.toInteger=at,s.toLength=vl,s.toLower=function(t){return wt(t).toLowerCase()},s.toNumber=ye,s.toSafeInteger=function(t){return t?dr(at(t),-9007199254740991,Q):t===0?t:0},s.toString=wt,s.toUpper=function(t){return wt(t).toUpperCase()},s.trim=function(t,e,r){if((t=wt(t))&&(r||e===h))return t.replace(Kt,"");if(!t||!(e=pe(e)))return t;var o=ke(t),a=ke(e);return ir(o,Ho(o,a),Uo(o,a)+1).join("")},s.trimEnd=function(t,e,r){if((t=wt(t))&&(r||e===h))return t.replace(pn,"");if(!t||!(e=pe(e)))return t;var o=ke(t);return ir(o,0,Uo(o,ke(e))+1).join("")},s.trimStart=function(t,e,r){if((t=wt(t))&&(r||e===h))return t.replace(hn,"");if(!t||!(e=pe(e)))return t;var o=ke(t);return ir(o,Ho(o,ke(e))).join("")},s.truncate=function(t,e){var r=30,o="...";if(Ft(e)){var a="separator"in e?e.separator:a;r="length"in e?at(e.length):r,o="omission"in e?pe(e.omission):o}var A=(t=wt(t)).length;if(yr(t)){var u=ke(t);A=u.length}if(r>=A)return t;var d=r-Ir(o);if(d<1)return o;var g=u?ir(u,0,d).join(""):t.slice(0,d);if(a===h)return g+o;if(u&&(d+=g.length-d),po(a)){if(t.slice(d).search(a)){var v,x=g;for(a.global||(a=zi(a.source,wt(ie.exec(a))+"g")),a.lastIndex=0;v=a.exec(x);)var E=v.index;g=g.slice(0,E===h?d:E)}}else if(t.indexOf(pe(a),d)!=d){var P=g.lastIndexOf(a);P>-1&&(g=g.slice(0,P))}return g+o},s.unescape=function(t){return(t=wt(t))&&Ke.test(t)?t.replace(sn,cs):t},s.uniqueId=function(t){var e=++us;return wt(t)+e},s.upperCase=ZA,s.upperFirst=go,s.each=Al,s.eachRight=cl,s.first=ol,wo(s,(xo={},We(s,(function(t,e){vt.call(s.prototype,e)||(xo[e]=t)})),xo),{chain:!1}),s.VERSION="4.17.20",Ce(["bind","bindKey","curry","curryRight","partial","partialRight"],(function(t){s[t].placeholder=s})),Ce(["drop","take"],(function(t,e){ht.prototype[t]=function(r){r=r===h?1:Rt(at(r),0);var o=this.__filtered__&&!e?new ht(this):this.clone();return o.__filtered__?o.__takeCount__=Xt(r,o.__takeCount__):o.__views__.push({size:Xt(r,F),type:t+(o.__dir__<0?"Right":"")}),o},ht.prototype[t+"Right"]=function(r){return this.reverse()[t](r).reverse()}})),Ce(["filter","map","takeWhile"],(function(t,e){var r=e+1,o=r==1||r==3;ht.prototype[t]=function(a){var A=this.clone();return A.__iteratees__.push({iteratee:J(a,3),type:r}),A.__filtered__=A.__filtered__||o,A}})),Ce(["head","last"],(function(t,e){var r="take"+(e?"Right":"");ht.prototype[t]=function(){return this[r](1).value()[0]}})),Ce(["initial","tail"],(function(t,e){var r="drop"+(e?"":"Right");ht.prototype[t]=function(){return this.__filtered__?new ht(this):this[r](1)}})),ht.prototype.compact=function(){return this.filter(se)},ht.prototype.find=function(t){return this.filter(t).head()},ht.prototype.findLast=function(t){return this.reverse().find(t)},ht.prototype.invokeMap=st((function(t,e){return typeof t=="function"?new ht(this):this.map((function(r){return $r(r,t,e)}))})),ht.prototype.reject=function(t){return this.filter(qn(J(t)))},ht.prototype.slice=function(t,e){t=at(t);var r=this;return r.__filtered__&&(t>0||e<0)?new ht(r):(t<0?r=r.takeRight(-t):t&&(r=r.drop(t)),e!==h&&(r=(e=at(e))<0?r.dropRight(-e):r.take(e-t)),r)},ht.prototype.takeRightWhile=function(t){return this.reverse().takeWhile(t).reverse()},ht.prototype.toArray=function(){return this.take(F)},We(ht.prototype,(function(t,e){var r=/^(?:filter|find|map|reject)|While$/.test(e),o=/^(?:head|last)$/.test(e),a=s[o?"take"+(e=="last"?"Right":""):e],A=o||/^find/.test(e);a&&(s.prototype[e]=function(){var u=this.__wrapped__,d=o?[1]:arguments,g=u instanceof ht,v=d[0],x=g||nt(u),E=function(V){var M=a.apply(s,qe([V],d));return o&&P?M[0]:M};x&&r&&typeof v=="function"&&v.length!=1&&(g=x=!1);var P=this.__chain__,R=!!this.__actions__.length,G=A&&!P,k=g&&!R;if(!A&&x){u=k?u:new ht(this);var T=t.apply(u,d);return T.__actions__.push({func:Zn,args:[E],thisArg:h}),new Be(T,P)}return G&&k?t.apply(this,d):(T=this.thru(E),G?o?T.value()[0]:T.value():T)})})),Ce(["pop","push","shift","sort","splice","unshift"],(function(t){var e=Bn[t],r=/^(?:push|sort|unshift)$/.test(t)?"tap":"thru",o=/^(?:pop|shift)$/.test(t);s.prototype[t]=function(){var a=arguments;if(o&&!this.__chain__){var A=this.value();return e.apply(nt(A)?A:[],a)}return this[r]((function(u){return e.apply(nt(u)?u:[],a)}))}})),We(ht.prototype,(function(t,e){var r=s[e];if(r){var o=r.name+"";vt.call(zr,o)||(zr[o]=[]),zr[o].push({name:e,func:r})}})),zr[Rn(h,2).name]=[{name:"wrapper",func:h}],ht.prototype.clone=function(){var t=new ht(this.__wrapped__);return t.__actions__=oe(this.__actions__),t.__dir__=this.__dir__,t.__filtered__=this.__filtered__,t.__iteratees__=oe(this.__iteratees__),t.__takeCount__=this.__takeCount__,t.__views__=oe(this.__views__),t},ht.prototype.reverse=function(){if(this.__filtered__){var t=new ht(this);t.__dir__=-1,t.__filtered__=!0}else(t=this.clone()).__dir__*=-1;return t},ht.prototype.value=function(){var t=this.__wrapped__.value(),e=this.__dir__,r=nt(t),o=e<0,a=r?t.length:0,A=(function(ct,N,K){for(var Nt=-1,de=K.length;++Nt<de;){var Me=K[Nt],Ot=Me.size;switch(Me.type){case"drop":ct+=Ot;break;case"dropRight":N-=Ot;break;case"take":N=Xt(N,ct+Ot);break;case"takeRight":ct=Rt(ct,N-Ot)}}return{start:ct,end:N}})(0,a,this.__views__),u=A.start,d=A.end,g=d-u,v=o?d:u-1,x=this.__iteratees__,E=x.length,P=0,R=Xt(g,this.__takeCount__);if(!r||!o&&a==g&&R==g)return ya(t,this.__actions__);var G=[];t:for(;g--&&P<R;){for(var k=-1,T=t[v+=e];++k<E;){var V=x[k],M=V.iteratee,X=V.type,q=M(T);if(X==2)T=q;else if(!q){if(X==1)continue t;break t}}G[P++]=T}return G},s.prototype.at=pA,s.prototype.chain=function(){return sl(this)},s.prototype.commit=function(){return new Be(this.value(),this.__chain__)},s.prototype.next=function(){this.__values__===h&&(this.__values__=Bl(this.value()));var t=this.__index__>=this.__values__.length;return{done:t,value:t?h:this.__values__[this.__index__++]}},s.prototype.plant=function(t){for(var e,r=this;r instanceof Ln;){var o=el(r);o.__index__=0,o.__values__=h,e?a.__wrapped__=o:e=o;var a=o;r=r.__wrapped__}return a.__wrapped__=t,e},s.prototype.reverse=function(){var t=this.__wrapped__;if(t instanceof ht){var e=t;return this.__actions__.length&&(e=new ht(this)),(e=e.reverse()).__actions__.push({func:Zn,args:[lo],thisArg:h}),new Be(e,this.__chain__)}return this.thru(lo)},s.prototype.toJSON=s.prototype.valueOf=s.prototype.value=function(){return ya(this.__wrapped__,this.__actions__)},s.prototype.first=s.prototype.head,Gr&&(s.prototype[Gr]=function(){return this}),s})();Jt._=wn,($=function(){return wn}.call(_,S,_,O))===h||(O.exports=$)}.call(this)},379:(O,_,S)=>{"use strict";var $,h=function(){return $===void 0&&($=!!(window&&document&&document.all&&!window.atob)),$},U=(function(){var b={};return function(B){if(b[B]===void 0){var z=document.querySelector(B);if(window.HTMLIFrameElement&&z instanceof window.HTMLIFrameElement)try{z=z.contentDocument.head}catch{z=null}b[B]=z}return b[B]}})(),it=[];function et(b){for(var B=-1,z=0;z<it.length;z++)if(it[z].identifier===b){B=z;break}return B}function bt(b,B){for(var z={},Y=[],Z=0;Z<b.length;Z++){var rt=b[Z],lt=B.base?rt[0]+B.base:rt[0],gt=z[lt]||0,At="".concat(lt," ").concat(gt);z[lt]=gt+1;var Lt=et(At),St={css:rt[1],media:rt[2],sourceMap:rt[3]};Lt!==-1?(it[Lt].references++,it[Lt].updater(St)):it.push({identifier:At,updater:F(St,B),references:1}),Y.push(At)}return Y}function pt(b){var B=document.createElement("style"),z=b.attributes||{};if(z.nonce===void 0){var Y=S.nc;Y&&(z.nonce=Y)}if(Object.keys(z).forEach((function(rt){B.setAttribute(rt,z[rt])})),typeof b.insert=="function")b.insert(B);else{var Z=U(b.insert||"head");if(!Z)throw new Error("Couldn't find a style target. This probably means that the value for the 'insert' parameter is invalid.");Z.appendChild(B)}return B}var ut,dt=(ut=[],function(b,B){return ut[b]=B,ut.filter(Boolean).join(`
`)});function _t(b,B,z,Y){var Z=z?"":Y.media?"@media ".concat(Y.media," {").concat(Y.css,"}"):Y.css;if(b.styleSheet)b.styleSheet.cssText=dt(B,Z);else{var rt=document.createTextNode(Z),lt=b.childNodes;lt[B]&&b.removeChild(lt[B]),lt.length?b.insertBefore(rt,lt[B]):b.appendChild(rt)}}function H(b,B,z){var Y=z.css,Z=z.media,rt=z.sourceMap;if(Z?b.setAttribute("media",Z):b.removeAttribute("media"),rt&&typeof btoa<"u"&&(Y+=`
/*# sourceMappingURL=data:application/json;base64,`.concat(btoa(unescape(encodeURIComponent(JSON.stringify(rt))))," */")),b.styleSheet)b.styleSheet.cssText=Y;else{for(;b.firstChild;)b.removeChild(b.firstChild);b.appendChild(document.createTextNode(Y))}}var Q=null,D=0;function F(b,B){var z,Y,Z;if(B.singleton){var rt=D++;z=Q||(Q=pt(B)),Y=_t.bind(null,z,rt,!1),Z=_t.bind(null,z,rt,!0)}else z=pt(B),Y=H.bind(null,z,B),Z=function(){(function(lt){if(lt.parentNode===null)return!1;lt.parentNode.removeChild(lt)})(z)};return Y(b),function(lt){if(lt){if(lt.css===b.css&&lt.media===b.media&&lt.sourceMap===b.sourceMap)return;Y(b=lt)}else Z()}}O.exports=function(b,B){(B=B||{}).singleton||typeof B.singleton=="boolean"||(B.singleton=h());var z=bt(b=b||[],B);return function(Y){if(Y=Y||[],Object.prototype.toString.call(Y)==="[object Array]"){for(var Z=0;Z<z.length;Z++){var rt=et(z[Z]);it[rt].references--}for(var lt=bt(Y,B),gt=0;gt<z.length;gt++){var At=et(z[gt]);it[At].references===0&&(it[At].updater(),it.splice(At,1))}z=lt}}}},122:(O,_,S)=>{"use strict";S.d(_,{Z:()=>$});let $="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48ZyBmaWxsPSIjNDY0NjQ2Ij48cGF0aCBkPSJNMCAwaDUwdjUwSDB6TTUwIDUwaDUwdjUwSDUweiIvPjwvZz48L3N2Zz4="},788:(O,_,S)=>{"use strict";S.d(_,{Z:()=>$});let $="data:font/ttf;base64,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FQAAAAAD//8AAAJeAmQADAAZADIAAAErASIGFBY7ATI2NCYHIi4BND4BMh4BFA4BBSc2NzY1NC4BIg4BFB4BMzI3NjcXHgE2NAFzTpANDw8N3g0PD305WzQ0W3FcNDRcARt/GgsJRXeNdkZGdkcxISUgmQUYDgGAEhwTExwS5zRccVs0NFtxXDRomSAlITFHdkZGdo13RQkLGoAFAg8VAAAAABAAxgABAAAAAAABAAwAAAABAAAAAAACAAcADAABAAAAAAADAAwAEwABAAAAAAAEAAwAHwABAAAAAAAFAAsAKwABAAAAAAAGAAwANgABAAAAAAAKACsAQgABAAAAAAALABMAbQADAAEECQABABgAgAADAAEECQACAA4AmAADAAEECQADABgApgADAAEECQAEABgAvgADAAEECQAFABYA1gADAAEECQAGABgA7AADAAEECQAKAFYBBAADAAEECQALACYBWnB0cm9pY29uZm9udFJlZ3VsYXJwdHJvaWNvbmZvbnRwdHJvaWNvbmZvbnRWZXJzaW9uIDEuMHB0cm9pY29uZm9udEdlbmVyYXRlZCBieSBzdmcydHRmIGZyb20gRm9udGVsbG8gcHJvamVjdC5odHRwOi8vZm9udGVsbG8uY29tAHAAdAByAG8AaQBjAG8AbgBmAG8AbgB0AFIAZQBnAHUAbABhAHIAcAB0AHIAbwBpAGMAbwBuAGYAbwBuAHQAcAB0AHIAbwBpAGMAbwBuAGYAbwBuAHQAVgBlAHIAcwBpAG8AbgAgADEALgAwAHAAdAByAG8AaQBjAG8AbgBmAG8AbgB0AEcAZQBuAGUAcgBhAHQAZQBkACAAYgB5ACAAcwB2AGcAMgB0AHQAZgAgAGYAcgBvAG0AIABGAG8AbgB0AGUAbABsAG8AIABwAHIAbwBqAGUAYwB0AC4AaAB0AHQAcAA6AC8ALwBmAG8AbgB0AGUAbABsAG8ALgBjAG8AbQAAAAIAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPwECAQMBBAEFAQYBBwEIAQkBCgELAQwBDQEOAQ8BEAERARIBEwEUARUBFgEXARgBGQEaARsBHAEdAR4BHwEgASEBIgEjASQBJQEmAScBKAEpASoBKwEsAS0BLgEvATABMQEyATMBNAE1ATYBNwE4ATkBOgE7ATwBPQE+AT8BQAAFYXBwbHkFYXJyb3cFYnJ1c2gGYnVja2V0BWNsZWFyBWNsb3NlBGNyb3AHZWxsaXBzZQZlcmFzZXIHZmlsdGVycwRsaW5lBmxpbmtlZAdsb2FkaW5nBm1pcnJvcgRvcGVuCnBhaW50ZXJybzARcGFzdGVfZXh0ZW5kX2Rvd24RcGFzdGVfZXh0ZW5kX2xlZnQScGFzdGVfZXh0ZW5kX3JpZ2h0EHBhc3RlX2V4dGVuZF90b3AJcGFzdGVfZml0CnBhc3RlX292ZXIHcGlwZXR0ZQhwaXhlbGl6ZQRyZWN0BHJlZG8GcmVzaXplBnJvdGF0ZQRzYXZlBnNlbGVjdAhzZXR0aW5ncwR0ZXh0BHVuZG8IdW5saW5rZWQGem9vbWluB3pvb21vdXQBYQFwAWwBeQFyAW8BdwFiAXUBcwFoAWMBawFlAXQBaQFmAW4BZAFnAW0BMAFfAXgBdgF6AAA="},796:(O,_,S)=>{"use strict";S.d(_,{Z:()=>$});let $="data:font/woff;base64,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"}},Ht={};function Pt(O){if(Ht[O])return Ht[O].exports;var _=Ht[O]={id:O,loaded:!1,exports:{}};return re[O].call(_.exports,_,_.exports,Pt),_.loaded=!0,_.exports}return Pt.n=O=>{var _=O&&O.__esModule?()=>O.default:()=>O;return Pt.d(_,{a:_}),_},Pt.d=(O,_)=>{for(var S in _)Pt.o(_,S)&&!Pt.o(O,S)&&Object.defineProperty(O,S,{enumerable:!0,get:_[S]})},Pt.g=(function(){if(typeof globalThis=="object")return globalThis;try{return this||new Function("return this")()}catch{if(typeof window=="object")return window}})(),Pt.o=(O,_)=>Object.prototype.hasOwnProperty.call(O,_),Pt.r=O=>{typeof Symbol<"u"&&Symbol.toStringTag&&Object.defineProperty(O,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(O,"__esModule",{value:!0})},Pt.nmd=O=>(O.paths=[],O.children||(O.children=[]),O),Pt(34)})()});var Yl=wc(_l(),1),bc=Yl.default.default;export{bc as default};
