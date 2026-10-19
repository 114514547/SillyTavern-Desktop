'use strict';
const path=require('node:path');const {inspect}=require('../../desktop/services/installation.cjs');
const {Lifecycle}=require('../../desktop/services/lifecycle.cjs');
(async()=>{const i=await inspect(process.argv[2]);const service=new Lifecycle({node:process.execPath,services:path.resolve(__dirname,'../../desktop/services')});const active=await service.start(i,{skipExternalCheck:true,timeout:30000});process.send({url:active.url,pid:active.pid},()=>process.exit(91));})().catch(()=>process.exit(92));
