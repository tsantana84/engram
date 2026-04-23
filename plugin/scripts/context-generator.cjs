"use strict";var Ot=Object.create;var w=Object.defineProperty;var Rt=Object.getOwnPropertyDescriptor;var It=Object.getOwnPropertyNames;var Lt=Object.getPrototypeOf,Ct=Object.prototype.hasOwnProperty;var Mt=(r,e)=>{for(var t in e)w(r,t,{get:e[t],enumerable:!0})},me=(r,e,t,s)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of It(e))!Ct.call(r,n)&&n!==t&&w(r,n,{get:()=>e[n],enumerable:!(s=Rt(e,n))||s.enumerable});return r};var D=(r,e,t)=>(t=r!=null?Ot(Lt(r)):{},me(e||!r||!r.__esModule?w(t,"default",{value:r,enumerable:!0}):t,r)),Dt=r=>me(w({},"__esModule",{value:!0}),r);var Zt={};Mt(Zt,{generateContext:()=>ce});module.exports=Dt(Zt);var bt=D(require("path"),1),ht=require("os"),Nt=require("fs");var Ne=require("bun:sqlite"),Ae=require("child_process");var S=require("path"),Q=require("os"),P=require("fs");var Te=require("url");var L=require("fs"),y=require("path"),le=require("os"),K=(i=>(i[i.DEBUG=0]="DEBUG",i[i.INFO=1]="INFO",i[i.WARN=2]="WARN",i[i.ERROR=3]="ERROR",i[i.SILENT=4]="SILENT",i))(K||{}),pe=(0,y.join)((0,le.homedir)(),".engram"),J=class{level=null;useColor;logFilePath=null;logFileInitialized=!1;sinks=[];constructor(){this.useColor=process.stdout.isTTY??!1}ensureLogFileInitialized(){if(!this.logFileInitialized){this.logFileInitialized=!0;try{let e=(0,y.join)(pe,"logs");(0,L.existsSync)(e)||(0,L.mkdirSync)(e,{recursive:!0});let t=new Date().toISOString().split("T")[0];this.logFilePath=(0,y.join)(e,`engram-${t}.log`)}catch(e){console.error("[LOGGER] Failed to initialize log file:",e),this.logFilePath=null}}}getLevel(){if(this.level===null)try{let e=(0,y.join)(pe,"settings.json");if((0,L.existsSync)(e)){let t=(0,L.readFileSync)(e,"utf-8"),n=(JSON.parse(t).CLAUDE_MEM_LOG_LEVEL||"INFO").toUpperCase();this.level=K[n]??1}else this.level=1}catch{this.level=1}return this.level}correlationId(e,t){return`obs-${e}-${t}`}sessionId(e){return`session-${e}`}formatData(e){if(e==null)return"";if(typeof e=="string")return e;if(typeof e=="number"||typeof e=="boolean")return e.toString();if(typeof e=="object"){if(e instanceof Error)return this.getLevel()===0?`${e.message}
${e.stack}`:e.message;if(Array.isArray(e))return`[${e.length} items]`;let t=Object.keys(e);return t.length===0?"{}":t.length<=3?JSON.stringify(e):`{${t.length} keys: ${t.slice(0,3).join(", ")}...}`}return String(e)}formatTool(e,t){if(!t)return e;let s=t;if(typeof t=="string")try{s=JSON.parse(t)}catch{s=t}if(e==="Bash"&&s.command)return`${e}(${s.command})`;if(s.file_path)return`${e}(${s.file_path})`;if(s.notebook_path)return`${e}(${s.notebook_path})`;if(e==="Glob"&&s.pattern)return`${e}(${s.pattern})`;if(e==="Grep"&&s.pattern)return`${e}(${s.pattern})`;if(s.url)return`${e}(${s.url})`;if(s.query)return`${e}(${s.query})`;if(e==="Task"){if(s.subagent_type)return`${e}(${s.subagent_type})`;if(s.description)return`${e}(${s.description})`}return e==="Skill"&&s.skill?`${e}(${s.skill})`:e==="LSP"&&s.operation?`${e}(${s.operation})`:e}formatTimestamp(e){let t=e.getFullYear(),s=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0"),i=String(e.getHours()).padStart(2,"0"),o=String(e.getMinutes()).padStart(2,"0"),a=String(e.getSeconds()).padStart(2,"0"),d=String(e.getMilliseconds()).padStart(3,"0");return`${t}-${s}-${n} ${i}:${o}:${a}.${d}`}log(e,t,s,n,i){if(e<this.getLevel())return;this.ensureLogFileInitialized();let o=this.formatTimestamp(new Date),a=K[e].padEnd(5),d=t.padEnd(6),c="";n?.correlationId?c=`[${n.correlationId}] `:n?.sessionId&&(c=`[session-${n.sessionId}] `);let E="";i!=null&&(i instanceof Error?E=this.getLevel()===0?`
${i.message}
${i.stack}`:` ${i.message}`:this.getLevel()===0&&typeof i=="object"?E=`
`+JSON.stringify(i,null,2):E=" "+this.formatData(i));let p="";if(n){let{sessionId:g,memorySessionId:f,correlationId:O,...m}=n;Object.keys(m).length>0&&(p=` {${Object.entries(m).map(([T,b])=>`${T}=${b}`).join(", ")}}`)}let l=`[${o}] [${a}] [${d}] ${c}${s}${p}${E}`;if(this.logFilePath)try{(0,L.appendFileSync)(this.logFilePath,l+`
`,"utf8")}catch(g){process.stderr.write(`[LOGGER] Failed to write to log file: ${g}
`)}else process.stderr.write(l+`
`)}addSink(e){this.sinks.push(e)}removeSink(e){this.sinks=this.sinks.filter(t=>t!==e)}notifySinks(e,t,s){let n={ts:new Date().toISOString(),level:e,ctx:t,msg:s};for(let i of this.sinks)try{i(n)}catch{}}debug(e,t,s,n){this.log(0,e,t,s,n)}info(e,t,s,n){this.log(1,e,t,s,n)}warn(e,t,s,n){this.log(2,e,t,s,n),this.notifySinks("warn",e,t)}error(e,t,s,n){this.log(3,e,t,s,n),this.notifySinks("error",e,t)}dataIn(e,t,s,n){this.info(e,`\u2192 ${t}`,s,n)}dataOut(e,t,s,n){this.info(e,`\u2190 ${t}`,s,n)}success(e,t,s,n){this.info(e,`\u2713 ${t}`,s,n)}failure(e,t,s,n){this.error(e,`\u2717 ${t}`,s,n)}timing(e,t,s,n){this.info(e,`\u23F1 ${t}`,n,{duration:`${s}ms`})}happyPathError(e,t,s,n,i=""){let c=((new Error().stack||"").split(`
`)[2]||"").match(/at\s+(?:.*\s+)?\(?([^:]+):(\d+):(\d+)\)?/),E=c?`${c[1].split("/").pop()}:${c[2]}`:"unknown",p={...s,location:E};return this.warn(e,`[HAPPY-PATH] ${t}`,p,n),i}},u=new J;var xt={};function yt(){return typeof __dirname<"u"?__dirname:(0,S.dirname)((0,Te.fileURLToPath)(xt.url))}var vt=yt();function Ut(){if(process.env.CLAUDE_MEM_DATA_DIR)return process.env.CLAUDE_MEM_DATA_DIR;let r=(0,S.join)((0,Q.homedir)(),".engram"),e=(0,S.join)(r,"settings.json");try{if((0,P.existsSync)(e)){let{readFileSync:t}=require("fs"),s=JSON.parse(t(e,"utf-8")),n=s.env??s;if(n.CLAUDE_MEM_DATA_DIR)return n.CLAUDE_MEM_DATA_DIR}}catch{}return r}var R=Ut(),C=process.env.CLAUDE_CONFIG_DIR||(0,S.join)((0,Q.homedir)(),".claude"),ns=(0,S.join)(C,"plugins","marketplaces","thedotmack"),is=(0,S.join)(R,"archives"),os=(0,S.join)(R,"logs"),as=(0,S.join)(R,"trash"),ds=(0,S.join)(R,"backups"),_s=(0,S.join)(R,"modes"),us=(0,S.join)(R,"settings.json"),ge=(0,S.join)(R,"claude-mem.db"),cs=(0,S.join)(R,"vector-db"),Es=(0,S.join)(R,"observer-sessions"),ms=(0,S.join)(C,"settings.json"),ps=(0,S.join)(C,"commands"),ls=(0,S.join)(C,"CLAUDE.md");function Se(r){(0,P.mkdirSync)(r,{recursive:!0})}function fe(){return(0,S.join)(vt,"..")}var be=require("crypto");var kt=3e4;function $(r,e,t){return(0,be.createHash)("sha256").update([r||"",e||"",t||""].join("\0")).digest("hex").slice(0,16)}function X(r,e,t){let s=t-kt;return r.prepare("SELECT id, created_at_epoch FROM observations WHERE content_hash = ? AND created_at_epoch > ?").get(e,s)}function z(r){if(!r)return[];try{let e=JSON.parse(r);return Array.isArray(e)?e:[String(e)]}catch{return[r]}}var h="claude";function Ft(r){return r.trim().toLowerCase().replace(/\s+/g,"-")}function M(r){if(!r)return h;let e=Ft(r);return e?e==="transcript"||e.includes("codex")?"codex":e.includes("cursor")?"cursor":e.includes("claude")?"claude":e:h}function he(r){let e=["claude","codex","cursor"];return[...r].sort((t,s)=>{let n=e.indexOf(t),i=e.indexOf(s);return n!==-1||i!==-1?n===-1?1:i===-1?-1:n-i:t.localeCompare(s)})}function wt(r,e){return{customTitle:r,platformSource:e?M(e):void 0}}var H=class{db;syncQueue=null;setSyncQueue(e){this.syncQueue=e}constructor(e=ge){e!==":memory:"&&Se(R),this.db=new Ne.Database(e),this.db.run("PRAGMA journal_mode = WAL"),this.db.run("PRAGMA synchronous = NORMAL"),this.db.run("PRAGMA foreign_keys = ON"),this.initializeSchema(),this.ensureWorkerPortColumn(),this.ensurePromptTrackingColumns(),this.removeSessionSummariesUniqueConstraint(),this.addObservationHierarchicalFields(),this.makeObservationsTextNullable(),this.createUserPromptsTable(),this.ensureDiscoveryTokensColumn(),this.createPendingMessagesTable(),this.renameSessionIdColumns(),this.repairSessionIdColumnRename(),this.addFailedAtEpochColumn(),this.addOnUpdateCascadeToForeignKeys(),this.addObservationContentHashColumn(),this.addSessionCustomTitleColumn(),this.addSessionPlatformSourceColumn(),this.addObservationModelColumns(),this.createSyncQueueTable(),this.addProvenanceColumns(),this.addExtractionStatusColumns(),this.widenSyncQueueForLearnings(),this.addLastErrorColumn(),this.createSessionBriefingsTable(),this.createGraphEdgesTable(),this.createTickLogTable(),this.createCorrectionsTable()}initializeSchema(){this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        id INTEGER PRIMARY KEY,
        version INTEGER UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      )
    `),this.db.run(`
      CREATE TABLE IF NOT EXISTS sdk_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT UNIQUE NOT NULL,
        memory_session_id TEXT UNIQUE,
        project TEXT NOT NULL,
        platform_source TEXT NOT NULL DEFAULT 'claude',
        user_prompt TEXT,
        started_at TEXT NOT NULL,
        started_at_epoch INTEGER NOT NULL,
        completed_at TEXT,
        completed_at_epoch INTEGER,
        status TEXT CHECK(status IN ('active', 'completed', 'failed')) NOT NULL DEFAULT 'active'
      );

      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project);
      CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT UNIQUE NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(4,new Date().toISOString())}ensureWorkerPortColumn(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(s=>s.name==="worker_port")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER"),u.debug("DB","Added worker_port column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(5,new Date().toISOString())}ensurePromptTrackingColumns(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(a=>a.name==="prompt_counter")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0"),u.debug("DB","Added prompt_counter column to sdk_sessions table")),this.db.query("PRAGMA table_info(observations)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE observations ADD COLUMN prompt_number INTEGER"),u.debug("DB","Added prompt_number column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER"),u.debug("DB","Added prompt_number column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(6,new Date().toISOString())}removeSessionSummariesUniqueConstraint(){if(!this.db.query("PRAGMA index_list(session_summaries)").all().some(s=>s.unique===1)){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString());return}u.debug("DB","Removing UNIQUE constraint from session_summaries.memory_session_id"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.db.run(`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, created_at, created_at_epoch
      FROM session_summaries
    `),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString()),u.debug("DB","Successfully removed UNIQUE constraint from session_summaries.memory_session_id")}addObservationHierarchicalFields(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(8))return;if(this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="title")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString());return}u.debug("DB","Adding hierarchical fields to observations table"),this.db.run(`
      ALTER TABLE observations ADD COLUMN title TEXT;
      ALTER TABLE observations ADD COLUMN subtitle TEXT;
      ALTER TABLE observations ADD COLUMN facts TEXT;
      ALTER TABLE observations ADD COLUMN narrative TEXT;
      ALTER TABLE observations ADD COLUMN concepts TEXT;
      ALTER TABLE observations ADD COLUMN files_read TEXT;
      ALTER TABLE observations ADD COLUMN files_modified TEXT;
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString()),u.debug("DB","Successfully added hierarchical fields to observations table")}makeObservationsTextNullable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(9))return;let s=this.db.query("PRAGMA table_info(observations)").all().find(n=>n.name==="text");if(!s||s.notnull===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString());return}u.debug("DB","Making observations.text nullable"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             created_at, created_at_epoch
      FROM observations
    `),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString()),u.debug("DB","Successfully made observations.text nullable")}createUserPromptsTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(10))return;if(this.db.query("PRAGMA table_info(user_prompts)").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString());return}u.debug("DB","Creating user_prompts table with FTS5 support"),this.db.run("BEGIN TRANSACTION"),this.db.run(`
      CREATE TABLE user_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT NOT NULL,
        prompt_number INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(content_session_id) REFERENCES sdk_sessions(content_session_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_user_prompts_claude_session ON user_prompts(content_session_id);
      CREATE INDEX idx_user_prompts_created ON user_prompts(created_at_epoch DESC);
      CREATE INDEX idx_user_prompts_prompt_number ON user_prompts(prompt_number);
      CREATE INDEX idx_user_prompts_lookup ON user_prompts(content_session_id, prompt_number);
    `);try{this.db.run(`
        CREATE VIRTUAL TABLE user_prompts_fts USING fts5(
          prompt_text,
          content='user_prompts',
          content_rowid='id'
        );
      `),this.db.run(`
        CREATE TRIGGER user_prompts_ai AFTER INSERT ON user_prompts BEGIN
          INSERT INTO user_prompts_fts(rowid, prompt_text)
          VALUES (new.id, new.prompt_text);
        END;

        CREATE TRIGGER user_prompts_ad AFTER DELETE ON user_prompts BEGIN
          INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
          VALUES('delete', old.id, old.prompt_text);
        END;

        CREATE TRIGGER user_prompts_au AFTER UPDATE ON user_prompts BEGIN
          INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
          VALUES('delete', old.id, old.prompt_text);
          INSERT INTO user_prompts_fts(rowid, prompt_text)
          VALUES (new.id, new.prompt_text);
        END;
      `)}catch(s){u.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},s)}this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),u.debug("DB","Successfully created user_prompts table")}ensureDiscoveryTokensColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(11))return;this.db.query("PRAGMA table_info(observations)").all().some(o=>o.name==="discovery_tokens")||(this.db.run("ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),u.debug("DB","Added discovery_tokens column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(o=>o.name==="discovery_tokens")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),u.debug("DB","Added discovery_tokens column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(11,new Date().toISOString())}createPendingMessagesTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(16))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString());return}u.debug("DB","Creating pending_messages table"),this.db.run(`
      CREATE TABLE pending_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER NOT NULL,
        content_session_id TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK(message_type IN ('observation', 'summarize')),
        tool_name TEXT,
        tool_input TEXT,
        tool_response TEXT,
        cwd TEXT,
        last_user_message TEXT,
        last_assistant_message TEXT,
        prompt_number INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'processed', 'failed')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at_epoch INTEGER NOT NULL,
        started_processing_at_epoch INTEGER,
        completed_at_epoch INTEGER,
        FOREIGN KEY (session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString()),u.debug("DB","pending_messages table created successfully")}renameSessionIdColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(17))return;u.debug("DB","Checking session ID columns for semantic clarity rename");let t=0,s=(n,i,o)=>{let a=this.db.query(`PRAGMA table_info(${n})`).all(),d=a.some(E=>E.name===i);return a.some(E=>E.name===o)?!1:d?(this.db.run(`ALTER TABLE ${n} RENAME COLUMN ${i} TO ${o}`),u.debug("DB",`Renamed ${n}.${i} to ${o}`),!0):(u.warn("DB",`Column ${i} not found in ${n}, skipping rename`),!1)};s("sdk_sessions","claude_session_id","content_session_id")&&t++,s("sdk_sessions","sdk_session_id","memory_session_id")&&t++,s("pending_messages","claude_session_id","content_session_id")&&t++,s("observations","sdk_session_id","memory_session_id")&&t++,s("session_summaries","sdk_session_id","memory_session_id")&&t++,s("user_prompts","claude_session_id","content_session_id")&&t++,this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(17,new Date().toISOString()),t>0?u.debug("DB",`Successfully renamed ${t} session ID columns`):u.debug("DB","No session ID column renames needed (already up to date)")}repairSessionIdColumnRename(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(19)||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(19,new Date().toISOString())}addFailedAtEpochColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(20))return;this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="failed_at_epoch")||(this.db.run("ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER"),u.debug("DB","Added failed_at_epoch column to pending_messages table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(20,new Date().toISOString())}addOnUpdateCascadeToForeignKeys(){if(!this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(21)){u.debug("DB","Adding ON UPDATE CASCADE to FK constraints on observations and session_summaries"),this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION");try{this.db.run("DROP TRIGGER IF EXISTS observations_ai"),this.db.run("DROP TRIGGER IF EXISTS observations_ad"),this.db.run("DROP TRIGGER IF EXISTS observations_au"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
        CREATE TABLE observations_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_session_id TEXT NOT NULL,
          project TEXT NOT NULL,
          text TEXT,
          type TEXT NOT NULL,
          title TEXT,
          subtitle TEXT,
          facts TEXT,
          narrative TEXT,
          concepts TEXT,
          files_read TEXT,
          files_modified TEXT,
          prompt_number INTEGER,
          discovery_tokens INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
        )
      `),this.db.run(`
        INSERT INTO observations_new
        SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
               narrative, concepts, files_read, files_modified, prompt_number,
               discovery_tokens, created_at, created_at_epoch
        FROM observations
      `),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(`
        CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
        CREATE INDEX idx_observations_project ON observations(project);
        CREATE INDEX idx_observations_type ON observations(type);
        CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
      `),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run(`
          CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
            INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
          END;

          CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
            INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
          END;

          CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
            INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
            INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
          END;
        `),this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.db.run(`
        CREATE TABLE session_summaries_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_session_id TEXT NOT NULL,
          project TEXT NOT NULL,
          request TEXT,
          investigated TEXT,
          learned TEXT,
          completed TEXT,
          next_steps TEXT,
          files_read TEXT,
          files_edited TEXT,
          notes TEXT,
          prompt_number INTEGER,
          discovery_tokens INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
        )
      `),this.db.run(`
        INSERT INTO session_summaries_new
        SELECT id, memory_session_id, project, request, investigated, learned,
               completed, next_steps, files_read, files_edited, notes,
               prompt_number, discovery_tokens, created_at, created_at_epoch
        FROM session_summaries
      `),this.db.run("DROP TRIGGER IF EXISTS session_summaries_ai"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_ad"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_au"),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(`
        CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
        CREATE INDEX idx_session_summaries_project ON session_summaries(project);
        CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
      `),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_summaries_fts'").all().length>0&&this.db.run(`
          CREATE TRIGGER IF NOT EXISTS session_summaries_ai AFTER INSERT ON session_summaries BEGIN
            INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
          END;

          CREATE TRIGGER IF NOT EXISTS session_summaries_ad AFTER DELETE ON session_summaries BEGIN
            INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
          END;

          CREATE TRIGGER IF NOT EXISTS session_summaries_au AFTER UPDATE ON session_summaries BEGIN
            INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
            INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
          END;
        `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(21,new Date().toISOString()),this.db.run("COMMIT"),this.db.run("PRAGMA foreign_keys = ON"),u.debug("DB","Successfully added ON UPDATE CASCADE to FK constraints")}catch(t){throw this.db.run("ROLLBACK"),this.db.run("PRAGMA foreign_keys = ON"),t}}}addObservationContentHashColumn(){if(this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="content_hash")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString());return}this.db.run("ALTER TABLE observations ADD COLUMN content_hash TEXT"),this.db.run("UPDATE observations SET content_hash = substr(hex(randomblob(8)), 1, 16) WHERE content_hash IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash, created_at_epoch)"),u.debug("DB","Added content_hash column to observations table with backfill and index"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString())}addSessionCustomTitleColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(23))return;this.db.query("PRAGMA table_info(sdk_sessions)").all().some(n=>n.name==="custom_title")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN custom_title TEXT"),u.debug("DB","Added custom_title column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(23,new Date().toISOString())}addSessionPlatformSourceColumn(){let t=this.db.query("PRAGMA table_info(sdk_sessions)").all().some(o=>o.name==="platform_source"),n=this.db.query("PRAGMA index_list(sdk_sessions)").all().some(o=>o.name==="idx_sdk_sessions_platform_source");this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(24)&&t&&n||(t||(this.db.run(`ALTER TABLE sdk_sessions ADD COLUMN platform_source TEXT NOT NULL DEFAULT '${h}'`),u.debug("DB","Added platform_source column to sdk_sessions table")),this.db.run(`
      UPDATE sdk_sessions
      SET platform_source = '${h}'
      WHERE platform_source IS NULL OR platform_source = ''
    `),n||this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(24,new Date().toISOString()))}addObservationModelColumns(){let e=this.db.query("PRAGMA table_info(observations)").all(),t=e.some(n=>n.name==="generated_by_model"),s=e.some(n=>n.name==="relevance_count");t&&s||(t||this.db.run("ALTER TABLE observations ADD COLUMN generated_by_model TEXT"),s||this.db.run("ALTER TABLE observations ADD COLUMN relevance_count INTEGER DEFAULT 0"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(26,new Date().toISOString()))}createSyncQueueTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(27)||(this.db.run(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL CHECK(entity_type IN ('observation', 'session', 'summary')),
        entity_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'synced', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        synced_at TEXT
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(27,new Date().toISOString()))}addExtractionStatusColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(29))return;let s=this.db.prepare("PRAGMA table_info('sdk_sessions')").all().map(n=>n.name);s.includes("extraction_status")||this.db.run("ALTER TABLE sdk_sessions ADD COLUMN extraction_status TEXT NOT NULL DEFAULT 'pending'"),s.includes("extraction_attempts")||this.db.run("ALTER TABLE sdk_sessions ADD COLUMN extraction_attempts INTEGER NOT NULL DEFAULT 0"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(29,new Date().toISOString()),u.debug("DB","Migration 29 applied: extraction_status columns on sdk_sessions")}widenSyncQueueForLearnings(){if(!this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(30)){this.db.run("BEGIN");try{this.db.run(`
        CREATE TABLE sync_queue_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL CHECK(entity_type IN ('observation','session','summary','learning')),
          entity_id INTEGER NOT NULL,
          target_status TEXT,
          payload TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','synced','failed','permanently_failed')),
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          synced_at TEXT
        )
      `),this.db.run(`INSERT INTO sync_queue_new (id, entity_type, entity_id, status, attempts, created_at, synced_at)
                   SELECT id, entity_type, entity_id, status, attempts, created_at, synced_at FROM sync_queue`),this.db.run("DROP TABLE sync_queue"),this.db.run("ALTER TABLE sync_queue_new RENAME TO sync_queue"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(30,new Date().toISOString()),this.db.run("COMMIT"),u.debug("DB","Migration 30 applied: sync_queue widened for learnings")}catch(t){throw this.db.run("ROLLBACK"),t}}}addProvenanceColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(28))return;let s=this.db.prepare("PRAGMA table_info(observations)").all().map(n=>n.name);s.includes("git_branch")||this.db.run("ALTER TABLE observations ADD COLUMN git_branch TEXT"),s.includes("invalidated_at")||this.db.run("ALTER TABLE observations ADD COLUMN invalidated_at INTEGER"),s.includes("validation_status")||this.db.run("ALTER TABLE observations ADD COLUMN validation_status TEXT DEFAULT 'unvalidated'"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_validation ON observations(validation_status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_invalidated ON observations(invalidated_at)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString())}updateMemorySessionId(e,t){this.db.prepare(`
      UPDATE sdk_sessions
      SET memory_session_id = ?
      WHERE id = ?
    `).run(t,e)}markSessionCompleted(e){let t=Date.now(),s=new Date(t).toISOString();this.db.prepare(`
      UPDATE sdk_sessions
      SET status = 'completed', completed_at = ?, completed_at_epoch = ?
      WHERE id = ?
    `).run(s,t,e)}resetStaleExtractionRows(){return this.db.run("UPDATE sdk_sessions SET extraction_status = 'failed' WHERE extraction_status = 'in_progress'").changes??0}markExtractionInProgress(e){this.db.run("UPDATE sdk_sessions SET extraction_status = 'in_progress' WHERE id = ?",[e])}markExtractionDone(e){this.db.run("UPDATE sdk_sessions SET extraction_status = 'done' WHERE id = ?",[e])}markExtractionPending(e){this.db.run("UPDATE sdk_sessions SET extraction_status = 'pending' WHERE id = ?",[e])}markExtractionFailed(e,t){this.db.run(`UPDATE sdk_sessions
       SET extraction_attempts = extraction_attempts + 1,
           extraction_status = CASE
             WHEN extraction_attempts + 1 >= ? THEN 'permanently_failed'
             ELSE 'failed'
           END
       WHERE id = ?`,[t,e])}getPendingExtractionSessions(e){return this.db.query(`SELECT id, project, memory_session_id FROM sdk_sessions
         WHERE extraction_status IN ('pending','failed')
           AND completed_at IS NOT NULL
         ORDER BY id ASC LIMIT ?`).all(e)}ensureMemorySessionIdRegistered(e,t){let s=this.db.prepare(`
      SELECT id, memory_session_id FROM sdk_sessions WHERE id = ?
    `).get(e);if(!s)throw new Error(`Session ${e} not found in sdk_sessions`);s.memory_session_id!==t&&(this.db.prepare(`
        UPDATE sdk_sessions SET memory_session_id = ? WHERE id = ?
      `).run(t,e),u.info("DB","Registered memory_session_id before storage (FK fix)",{sessionDbId:e,oldId:s.memory_session_id,newId:t}))}getRecentSummaries(e,t=10){return this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getRecentSummariesWithSessionInfo(e,t=3){return this.db.prepare(`
      SELECT
        memory_session_id, request, learned, completed, next_steps,
        prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getRecentObservations(e,t=20){return this.db.prepare(`
      SELECT type, text, prompt_number, created_at
      FROM observations
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getAllRecentObservations(e=100){return this.db.prepare(`
      SELECT
        o.id,
        o.type,
        o.title,
        o.subtitle,
        o.text,
        o.project,
        COALESCE(s.platform_source, '${h}') as platform_source,
        o.prompt_number,
        o.created_at,
        o.created_at_epoch
      FROM observations o
      LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
      ORDER BY o.created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllRecentSummaries(e=50){return this.db.prepare(`
      SELECT
        ss.id,
        ss.request,
        ss.investigated,
        ss.learned,
        ss.completed,
        ss.next_steps,
        ss.files_read,
        ss.files_edited,
        ss.notes,
        ss.project,
        COALESCE(s.platform_source, '${h}') as platform_source,
        ss.prompt_number,
        ss.created_at,
        ss.created_at_epoch
      FROM session_summaries ss
      LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
      ORDER BY ss.created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllRecentUserPrompts(e=100){return this.db.prepare(`
      SELECT
        up.id,
        up.content_session_id,
        s.project,
        COALESCE(s.platform_source, '${h}') as platform_source,
        up.prompt_number,
        up.prompt_text,
        up.created_at,
        up.created_at_epoch
      FROM user_prompts up
      LEFT JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      ORDER BY up.created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllProjects(e){let t=e?M(e):void 0,s=`
      SELECT DISTINCT project
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
    `,n=[];return t&&(s+=" AND COALESCE(platform_source, ?) = ?",n.push(h,t)),s+=" ORDER BY project ASC",this.db.prepare(s).all(...n).map(o=>o.project)}getProjectCatalog(){let e=this.db.prepare(`
      SELECT
        COALESCE(platform_source, '${h}') as platform_source,
        project,
        MAX(started_at_epoch) as latest_epoch
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
      GROUP BY COALESCE(platform_source, '${h}'), project
      ORDER BY latest_epoch DESC
    `).all(),t=[],s=new Set,n={};for(let o of e){let a=M(o.platform_source);n[a]||(n[a]=[]),n[a].includes(o.project)||n[a].push(o.project),s.has(o.project)||(s.add(o.project),t.push(o.project))}let i=he(Object.keys(n));return{projects:t,sources:i,projectsBySource:Object.fromEntries(i.map(o=>[o,n[o]||[]]))}}getLatestUserPrompt(e){return this.db.prepare(`
      SELECT
        up.*,
        s.memory_session_id,
        s.project,
        COALESCE(s.platform_source, '${h}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.content_session_id = ?
      ORDER BY up.created_at_epoch DESC
      LIMIT 1
    `).get(e)}getRecentSessionsWithStatus(e,t=3){return this.db.prepare(`
      SELECT * FROM (
        SELECT
          s.memory_session_id,
          s.status,
          s.started_at,
          s.started_at_epoch,
          s.user_prompt,
          CASE WHEN sum.memory_session_id IS NOT NULL THEN 1 ELSE 0 END as has_summary
        FROM sdk_sessions s
        LEFT JOIN session_summaries sum ON s.memory_session_id = sum.memory_session_id
        WHERE s.project = ? AND s.memory_session_id IS NOT NULL
        GROUP BY s.memory_session_id
        ORDER BY s.started_at_epoch DESC
        LIMIT ?
      )
      ORDER BY started_at_epoch ASC
    `).all(e,t)}getObservationsForSession(e){return this.db.prepare(`
      SELECT title, subtitle, type, prompt_number, narrative, facts
      FROM observations
      WHERE memory_session_id = ?
      ORDER BY created_at_epoch ASC
    `).all(e)}getSessionObservations(e){let t=this.getSessionById(e);return!t||!t.memory_session_id?[]:this.db.prepare("SELECT id, title, narrative FROM observations WHERE memory_session_id = ? ORDER BY created_at_epoch ASC").all(t.memory_session_id)}getObservationById(e){return this.db.prepare(`
      SELECT *
      FROM observations
      WHERE id = ?
    `).get(e)||null}getObservationsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:i,type:o,concepts:a,files:d}=t,c=s==="date_asc"?"ASC":"DESC",E=n?`LIMIT ${n}`:"",p=e.map(()=>"?").join(","),l=[...e],g=[];if(i&&(g.push("project = ?"),l.push(i)),o)if(Array.isArray(o)){let m=o.map(()=>"?").join(",");g.push(`type IN (${m})`),l.push(...o)}else g.push("type = ?"),l.push(o);if(a){let m=Array.isArray(a)?a:[a],N=m.map(()=>"EXISTS (SELECT 1 FROM json_each(concepts) WHERE value = ?)");l.push(...m),g.push(`(${N.join(" OR ")})`)}if(d){let m=Array.isArray(d)?d:[d],N=m.map(()=>"(EXISTS (SELECT 1 FROM json_each(files_read) WHERE value LIKE ?) OR EXISTS (SELECT 1 FROM json_each(files_modified) WHERE value LIKE ?))");m.forEach(T=>{l.push(`%${T}%`,`%${T}%`)}),g.push(`(${N.join(" OR ")})`)}let f=g.length>0?`WHERE id IN (${p}) AND ${g.join(" AND ")}`:`WHERE id IN (${p})`;return this.db.prepare(`
      SELECT *
      FROM observations
      ${f}
      ORDER BY created_at_epoch ${c}
      ${E}
    `).all(...l)}getSummaryById(e){return this.db.prepare(`
      SELECT * FROM session_summaries WHERE id = ?
    `).get(e)||null}getSummaryForSession(e){return this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at,
        created_at_epoch
      FROM session_summaries
      WHERE memory_session_id = ?
      ORDER BY created_at_epoch DESC
      LIMIT 1
    `).get(e)||null}getFilesForSession(e){let s=this.db.prepare(`
      SELECT files_read, files_modified
      FROM observations
      WHERE memory_session_id = ?
    `).all(e),n=new Set,i=new Set;for(let o of s)z(o.files_read).forEach(a=>n.add(a)),z(o.files_modified).forEach(a=>i.add(a));return{filesRead:Array.from(n),filesModified:Array.from(i)}}getSessionById(e){return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project,
             COALESCE(platform_source, '${h}') as platform_source,
             user_prompt, custom_title
      FROM sdk_sessions
      WHERE id = ?
      LIMIT 1
    `).get(e)||null}getSdkSessionsBySessionIds(e){if(e.length===0)return[];let t=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project,
             COALESCE(platform_source, '${h}') as platform_source,
             user_prompt, custom_title,
             started_at, started_at_epoch, completed_at, completed_at_epoch, status
      FROM sdk_sessions
      WHERE memory_session_id IN (${t})
      ORDER BY started_at_epoch DESC
    `).all(...e)}getPromptNumberFromUserPrompts(e){return this.db.prepare(`
      SELECT COUNT(*) as count FROM user_prompts WHERE content_session_id = ?
    `).get(e).count}createSDKSession(e,t,s,n,i){let o=new Date,a=o.getTime(),d=wt(n,i),c=d.platformSource??h,E=this.db.prepare(`
      SELECT id, platform_source FROM sdk_sessions WHERE content_session_id = ?
    `).get(e);if(E){if(t&&this.db.prepare(`
          UPDATE sdk_sessions SET project = ?
          WHERE content_session_id = ? AND (project IS NULL OR project = '')
        `).run(t,e),d.customTitle&&this.db.prepare(`
          UPDATE sdk_sessions SET custom_title = ?
          WHERE content_session_id = ? AND custom_title IS NULL
        `).run(d.customTitle,e),d.platformSource){let l=E.platform_source?.trim()?M(E.platform_source):void 0;if(!l)this.db.prepare(`
            UPDATE sdk_sessions SET platform_source = ?
            WHERE content_session_id = ?
              AND COALESCE(platform_source, '') = ''
          `).run(d.platformSource,e);else if(l!==d.platformSource)throw new Error(`Platform source conflict for session ${e}: existing=${l}, received=${d.platformSource}`)}return E.id}return this.db.prepare(`
      INSERT INTO sdk_sessions
      (content_session_id, memory_session_id, project, platform_source, user_prompt, custom_title, started_at, started_at_epoch, status)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'active')
    `).run(e,t,c,s,d.customTitle||null,o.toISOString(),a),this.db.prepare("SELECT id FROM sdk_sessions WHERE content_session_id = ?").get(e).id}saveUserPrompt(e,t,s){let n=new Date,i=n.getTime();return this.db.prepare(`
      INSERT INTO user_prompts
      (content_session_id, prompt_number, prompt_text, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?)
    `).run(e,t,s,n.toISOString(),i).lastInsertRowid}getUserPrompt(e,t){return this.db.prepare(`
      SELECT prompt_text
      FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
      LIMIT 1
    `).get(e,t)?.prompt_text??null}storeObservation(e,t,s,n,i=0,o,a){let d=o??Date.now(),c=new Date(d).toISOString(),E=$(e,s.title,s.narrative),p=X(this.db,E,d);if(p)return{id:p.id,createdAtEpoch:p.created_at_epoch};let l=null;try{let m=(0,Ae.spawnSync)("git",["rev-parse","--abbrev-ref","HEAD"],{encoding:"utf8",timeout:2e3});m.status===0&&!m.error&&(l=m.stdout.trim()||null)}catch{}let f=this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, content_hash, created_at, created_at_epoch,
       generated_by_model, git_branch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t,s.type,s.title,s.subtitle,JSON.stringify(s.facts),s.narrative,JSON.stringify(s.concepts),JSON.stringify(s.files_read),JSON.stringify(s.files_modified),n||null,i,E,c,d,a||null,l),O=Number(f.lastInsertRowid);return this.syncQueue?.enqueue("observation",O),{id:O,createdAtEpoch:d}}invalidateObservation(e,t){let s=Date.now();this.db.prepare(`
      UPDATE observations
      SET invalidated_at = ?, validation_status = 'invalidated'
      WHERE id = ?
    `).run(s,e),t&&u.info("MEMORY",`Observation #${e} invalidated: ${t}`)}validateObservation(e){this.db.prepare(`
      UPDATE observations SET validation_status = 'validated' WHERE id = ?
    `).run(e)}storeSummary(e,t,s,n,i=0,o){let a=o??Date.now(),d=new Date(a).toISOString(),E=this.db.prepare(`
      INSERT INTO session_summaries
      (memory_session_id, project, request, investigated, learned, completed,
       next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t,s.request,s.investigated,s.learned,s.completed,s.next_steps,s.notes,n||null,i,d,a),p=Number(E.lastInsertRowid);return this.syncQueue?.enqueue("summary",p),{id:p,createdAtEpoch:a}}storeObservations(e,t,s,n,i,o=0,a,d){let c=a??Date.now(),E=new Date(c).toISOString(),l=this.db.transaction(()=>{let g=[],f=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, content_hash, created_at, created_at_epoch,
         generated_by_model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);for(let m of s){let N=$(e,m.title,m.narrative),T=X(this.db,N,c);if(T){g.push(T.id);continue}let b=f.run(e,t,m.type,m.title,m.subtitle,JSON.stringify(m.facts),m.narrative,JSON.stringify(m.concepts),JSON.stringify(m.files_read),JSON.stringify(m.files_modified),i||null,o,N,E,c,d||null);g.push(Number(b.lastInsertRowid))}let O=null;if(n){let N=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,n.request,n.investigated,n.learned,n.completed,n.next_steps,n.notes,i||null,o,E,c);O=Number(N.lastInsertRowid)}return{observationIds:g,summaryId:O,createdAtEpoch:c}})();for(let g of l.observationIds)this.syncQueue?.enqueue("observation",g);return l.summaryId!==null&&this.syncQueue?.enqueue("summary",l.summaryId),l}storeObservationsAndMarkComplete(e,t,s,n,i,o,a,d=0,c,E){let p=c??Date.now(),l=new Date(p).toISOString();return this.db.transaction(()=>{let f=[],O=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, content_hash, created_at, created_at_epoch,
         generated_by_model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);for(let T of s){let b=$(e,T.title,T.narrative),Ee=X(this.db,b,p);if(Ee){f.push(Ee.id);continue}let At=O.run(e,t,T.type,T.title,T.subtitle,JSON.stringify(T.facts),T.narrative,JSON.stringify(T.concepts),JSON.stringify(T.files_read),JSON.stringify(T.files_modified),a||null,d,b,l,p,E||null);f.push(Number(At.lastInsertRowid))}let m;if(n){let b=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,n.request,n.investigated,n.learned,n.completed,n.next_steps,n.notes,a||null,d,l,p);m=Number(b.lastInsertRowid)}return this.db.prepare(`
        UPDATE pending_messages
        SET
          status = 'processed',
          completed_at_epoch = ?,
          tool_input = NULL,
          tool_response = NULL
        WHERE id = ? AND status = 'processing'
      `).run(p,i),{observationIds:f,summaryId:m,createdAtEpoch:p}})()}getSessionSummariesByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:i}=t,o=s==="date_asc"?"ASC":"DESC",a=n?`LIMIT ${n}`:"",d=e.map(()=>"?").join(","),c=[...e],E=i?`WHERE id IN (${d}) AND project = ?`:`WHERE id IN (${d})`;return i&&c.push(i),this.db.prepare(`
      SELECT * FROM session_summaries
      ${E}
      ORDER BY created_at_epoch ${o}
      ${a}
    `).all(...c)}getUserPromptsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:i}=t,o=s==="date_asc"?"ASC":"DESC",a=n?`LIMIT ${n}`:"",d=e.map(()=>"?").join(","),c=[...e],E=i?"AND s.project = ?":"";return i&&c.push(i),this.db.prepare(`
      SELECT
        up.*,
        s.project,
        s.memory_session_id
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.id IN (${d}) ${E}
      ORDER BY up.created_at_epoch ${o}
      ${a}
    `).all(...c)}getTimelineAroundTimestamp(e,t=10,s=10,n){return this.getTimelineAroundObservation(null,e,t,s,n)}getTimelineAroundObservation(e,t,s=10,n=10,i){let o=i?"AND project = ?":"",a=i?[i]:[],d,c;if(e!==null){let m=`
        SELECT id, created_at_epoch
        FROM observations
        WHERE id <= ? ${o}
        ORDER BY id DESC
        LIMIT ?
      `,N=`
        SELECT id, created_at_epoch
        FROM observations
        WHERE id >= ? ${o}
        ORDER BY id ASC
        LIMIT ?
      `;try{let T=this.db.prepare(m).all(e,...a,s+1),b=this.db.prepare(N).all(e,...a,n+1);if(T.length===0&&b.length===0)return{observations:[],sessions:[],prompts:[]};d=T.length>0?T[T.length-1].created_at_epoch:t,c=b.length>0?b[b.length-1].created_at_epoch:t}catch(T){return u.error("DB","Error getting boundary observations",void 0,{error:T,project:i}),{observations:[],sessions:[],prompts:[]}}}else{let m=`
        SELECT created_at_epoch
        FROM observations
        WHERE created_at_epoch <= ? ${o}
        ORDER BY created_at_epoch DESC
        LIMIT ?
      `,N=`
        SELECT created_at_epoch
        FROM observations
        WHERE created_at_epoch >= ? ${o}
        ORDER BY created_at_epoch ASC
        LIMIT ?
      `;try{let T=this.db.prepare(m).all(t,...a,s),b=this.db.prepare(N).all(t,...a,n+1);if(T.length===0&&b.length===0)return{observations:[],sessions:[],prompts:[]};d=T.length>0?T[T.length-1].created_at_epoch:t,c=b.length>0?b[b.length-1].created_at_epoch:t}catch(T){return u.error("DB","Error getting boundary timestamps",void 0,{error:T,project:i}),{observations:[],sessions:[],prompts:[]}}}let E=`
      SELECT *
      FROM observations
      WHERE created_at_epoch >= ? AND created_at_epoch <= ? ${o}
      ORDER BY created_at_epoch ASC
    `,p=`
      SELECT *
      FROM session_summaries
      WHERE created_at_epoch >= ? AND created_at_epoch <= ? ${o}
      ORDER BY created_at_epoch ASC
    `,l=`
      SELECT up.*, s.project, s.memory_session_id
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.created_at_epoch >= ? AND up.created_at_epoch <= ? ${o.replace("project","s.project")}
      ORDER BY up.created_at_epoch ASC
    `,g=this.db.prepare(E).all(d,c,...a),f=this.db.prepare(p).all(d,c,...a),O=this.db.prepare(l).all(d,c,...a);return{observations:g,sessions:f.map(m=>({id:m.id,memory_session_id:m.memory_session_id,project:m.project,request:m.request,completed:m.completed,next_steps:m.next_steps,created_at:m.created_at,created_at_epoch:m.created_at_epoch})),prompts:O.map(m=>({id:m.id,content_session_id:m.content_session_id,prompt_number:m.prompt_number,prompt_text:m.prompt_text,project:m.project,created_at:m.created_at,created_at_epoch:m.created_at_epoch}))}}getPromptById(e){return this.db.prepare(`
      SELECT
        p.id,
        p.content_session_id,
        p.prompt_number,
        p.prompt_text,
        s.project,
        p.created_at,
        p.created_at_epoch
      FROM user_prompts p
      LEFT JOIN sdk_sessions s ON p.content_session_id = s.content_session_id
      WHERE p.id = ?
      LIMIT 1
    `).get(e)||null}getPromptsByIds(e){if(e.length===0)return[];let t=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT
        p.id,
        p.content_session_id,
        p.prompt_number,
        p.prompt_text,
        s.project,
        p.created_at,
        p.created_at_epoch
      FROM user_prompts p
      LEFT JOIN sdk_sessions s ON p.content_session_id = s.content_session_id
      WHERE p.id IN (${t})
      ORDER BY p.created_at_epoch DESC
    `).all(...e)}getSessionSummaryById(e){return this.db.prepare(`
      SELECT
        id,
        memory_session_id,
        content_session_id,
        project,
        user_prompt,
        request_summary,
        learned_summary,
        status,
        created_at,
        created_at_epoch
      FROM sdk_sessions
      WHERE id = ?
      LIMIT 1
    `).get(e)||null}getOrCreateManualSession(e){let t=`manual-${e}`,s=`manual-content-${e}`;if(this.db.prepare("SELECT memory_session_id FROM sdk_sessions WHERE memory_session_id = ?").get(t))return t;let i=new Date;return this.db.prepare(`
      INSERT INTO sdk_sessions (memory_session_id, content_session_id, project, platform_source, started_at, started_at_epoch, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(t,s,e,h,i.toISOString(),i.getTime()),u.info("SESSION","Created manual session",{memorySessionId:t,project:e}),t}close(){this.db.close()}importSdkSession(e){let t=this.db.prepare("SELECT id FROM sdk_sessions WHERE content_session_id = ?").get(e.content_session_id);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO sdk_sessions (
        content_session_id, memory_session_id, project, platform_source, user_prompt,
        started_at, started_at_epoch, completed_at, completed_at_epoch, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.content_session_id,e.memory_session_id,e.project,M(e.platform_source),e.user_prompt,e.started_at,e.started_at_epoch,e.completed_at,e.completed_at_epoch,e.status).lastInsertRowid}}importSessionSummary(e){let t=this.db.prepare("SELECT id FROM session_summaries WHERE memory_session_id = ?").get(e.memory_session_id);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO session_summaries (
        memory_session_id, project, request, investigated, learned,
        completed, next_steps, files_read, files_edited, notes,
        prompt_number, discovery_tokens, created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,e.request,e.investigated,e.learned,e.completed,e.next_steps,e.files_read,e.files_edited,e.notes,e.prompt_number,e.discovery_tokens||0,e.created_at,e.created_at_epoch).lastInsertRowid}}importObservation(e){let t=this.db.prepare(`
      SELECT id FROM observations
      WHERE memory_session_id = ? AND title = ? AND created_at_epoch = ?
    `).get(e.memory_session_id,e.title,e.created_at_epoch);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO observations (
        memory_session_id, project, text, type, title, subtitle,
        facts, narrative, concepts, files_read, files_modified,
        prompt_number, discovery_tokens, created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,e.text,e.type,e.title,e.subtitle,e.facts,e.narrative,e.concepts,e.files_read,e.files_modified,e.prompt_number,e.discovery_tokens||0,e.created_at,e.created_at_epoch).lastInsertRowid}}rebuildObservationsFTSIndex(){this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')")}importUserPrompt(e){let t=this.db.prepare(`
      SELECT id FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
    `).get(e.content_session_id,e.prompt_number);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO user_prompts (
        content_session_id, prompt_number, prompt_text,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?)
    `).run(e.content_session_id,e.prompt_number,e.prompt_text,e.created_at,e.created_at_epoch).lastInsertRowid}}addLastErrorColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(31))return;this.db.prepare("PRAGMA table_info(sync_queue)").all().some(s=>s.name==="last_error")||this.db.run("ALTER TABLE sync_queue ADD COLUMN last_error TEXT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(31,new Date().toISOString()),u.debug("DB","Migration 31 applied: last_error column on sync_queue")}createSessionBriefingsTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(32)||(this.db.run(`
      CREATE TABLE IF NOT EXISTS session_briefings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        briefing_text TEXT NOT NULL,
        trigger TEXT NOT NULL DEFAULT 'pre_compact',
        consumed_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `),this.db.run(`CREATE INDEX IF NOT EXISTS idx_briefings_project_consumed
      ON session_briefings(project, consumed_at)`),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(32,new Date().toISOString()),u.debug("DB","Migration 32 applied: session_briefings table created"))}createGraphEdgesTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(33)||(this.db.run(`
      CREATE TABLE IF NOT EXISTS graph_edges (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        from_type        TEXT NOT NULL,
        from_id          TEXT NOT NULL,
        to_type          TEXT NOT NULL,
        to_id            TEXT NOT NULL,
        relationship     TEXT NOT NULL,
        weight           REAL DEFAULT 1.0,
        source           TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        UNIQUE(from_type, from_id, to_type, to_id, relationship)
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_graph_from ON graph_edges(from_type, from_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_graph_to ON graph_edges(to_type, to_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(33,new Date().toISOString()),u.debug("DB","Migration 33 applied: graph_edges table created"))}createTickLogTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(34)||(this.db.run(`
      CREATE TABLE IF NOT EXISTS tick_log (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        ticked_at           INTEGER NOT NULL DEFAULT (unixepoch()),
        agent_name          TEXT    NOT NULL DEFAULT '',
        duration_ms         INTEGER NOT NULL,
        sessions_extracted  INTEGER NOT NULL DEFAULT 0,
        learnings_enqueued  INTEGER NOT NULL DEFAULT 0,
        items_pushed        INTEGER NOT NULL DEFAULT 0,
        items_failed        INTEGER NOT NULL DEFAULT 0,
        queue_depth_after   INTEGER NOT NULL DEFAULT 0,
        errors              TEXT
      )
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(34,new Date().toISOString()),u.debug("DB","Migration 34 applied: tick_log table created"))}createCorrectionsTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(35)||(this.db.run(`
      CREATE TABLE IF NOT EXISTS corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tried TEXT NOT NULL,
        wrong_because TEXT NOT NULL,
        fix TEXT NOT NULL,
        trigger_context TEXT NOT NULL,
        weight_multiplier REAL NOT NULL DEFAULT 2.0,
        session_id TEXT,
        project TEXT,
        created_at INTEGER NOT NULL
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_corrections_trigger ON corrections(trigger_context)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_corrections_project ON corrections(project)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(35,new Date().toISOString()),u.debug("DB","Migration 35 applied: corrections table created"))}insertTickLog(e){this.db.prepare(`
      INSERT INTO tick_log
        (agent_name, duration_ms, sessions_extracted, learnings_enqueued,
         items_pushed, items_failed, queue_depth_after, errors)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.agent_name,e.duration_ms,e.sessions_extracted,e.learnings_enqueued,e.items_pushed,e.items_failed,e.queue_depth_after,e.errors.length>0?JSON.stringify(e.errors):null),this.db.run("DELETE FROM tick_log WHERE id < (SELECT MAX(id) - 999 FROM tick_log)")}getTickLog(e){return this.db.prepare(`
      SELECT id, ticked_at, agent_name, duration_ms, sessions_extracted,
             learnings_enqueued, items_pushed, items_failed, queue_depth_after, errors
      FROM tick_log ORDER BY ticked_at DESC, id DESC LIMIT ?
    `).all(e).map(s=>({id:s.id,ticked_at:s.ticked_at,agent_name:s.agent_name,duration_ms:s.duration_ms,sessions_extracted:s.sessions_extracted,learnings_enqueued:s.learnings_enqueued,items_pushed:s.items_pushed,items_failed:s.items_failed,queue_depth_after:s.queue_depth_after,errors:s.errors?JSON.parse(s.errors):[]}))}};var Oe=require("os"),Re=D(require("path"),1);function Pt(r){return r==="~"||r.startsWith("~/")?r.replace(/^~/,(0,Oe.homedir)()):r}function Ie(r){if(!r||r.trim()==="")return u.warn("PROJECT_NAME","Empty cwd provided, using fallback",{cwd:r}),"unknown-project";let e=Pt(r),t=Re.default.basename(e);if(t===""){if(process.platform==="win32"){let n=r.match(/^([A-Z]):\\/i);if(n){let o=`drive-${n[1].toUpperCase()}`;return u.info("PROJECT_NAME","Drive root detected",{cwd:r,projectName:o}),o}}return u.warn("PROJECT_NAME","Root directory detected, using fallback",{cwd:r}),"unknown-project"}return t}var Le=D(require("path"),1),Ce=require("os");var I=require("fs"),v=require("path"),Z=require("os"),G=class{static DEFAULTS={CLAUDE_MEM_MODEL:"claude-sonnet-4-6",CLAUDE_MEM_CONTEXT_OBSERVATIONS:"50",CLAUDE_MEM_WORKER_PORT:"37777",CLAUDE_MEM_WORKER_HOST:"127.0.0.1",CLAUDE_MEM_SKIP_TOOLS:"ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion",CLAUDE_MEM_PROVIDER:"claude",CLAUDE_MEM_CLAUDE_AUTH_METHOD:"cli",CLAUDE_MEM_GEMINI_API_KEY:"",CLAUDE_MEM_GEMINI_MODEL:"gemini-2.5-flash-lite",CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED:"true",CLAUDE_MEM_GEMINI_MAX_CONTEXT_MESSAGES:"20",CLAUDE_MEM_GEMINI_MAX_TOKENS:"100000",CLAUDE_MEM_OPENROUTER_API_KEY:"",CLAUDE_MEM_OPENROUTER_MODEL:"xiaomi/mimo-v2-flash:free",CLAUDE_MEM_OPENROUTER_SITE_URL:"",CLAUDE_MEM_OPENROUTER_APP_NAME:"claude-mem",CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES:"20",CLAUDE_MEM_OPENROUTER_MAX_TOKENS:"100000",CLAUDE_MEM_DATA_DIR:(0,v.join)((0,Z.homedir)(),".engram"),CLAUDE_MEM_LOG_LEVEL:"INFO",CLAUDE_MEM_PYTHON_VERSION:"3.13",CLAUDE_CODE_PATH:"",CLAUDE_MEM_MODE:"code",CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS:"false",CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS:"false",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT:"false",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT:"true",CLAUDE_MEM_CONTEXT_FULL_COUNT:"0",CLAUDE_MEM_CONTEXT_FULL_FIELD:"narrative",CLAUDE_MEM_CONTEXT_SESSION_COUNT:"10",CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY:"true",CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE:"false",CLAUDE_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT:"true",CLAUDE_MEM_FOLDER_CLAUDEMD_ENABLED:"false",CLAUDE_MEM_FOLDER_USE_LOCAL_MD:"false",CLAUDE_MEM_TRANSCRIPTS_ENABLED:"true",CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH:(0,v.join)((0,Z.homedir)(),".engram","transcript-watch.json"),CLAUDE_MEM_MAX_CONCURRENT_AGENTS:"2",CLAUDE_MEM_EXCLUDED_PROJECTS:"",CLAUDE_MEM_FOLDER_MD_EXCLUDE:"[]",CLAUDE_MEM_SEMANTIC_INJECT:"false",CLAUDE_MEM_SEMANTIC_INJECT_LIMIT:"5",CLAUDE_MEM_TIER_ROUTING_ENABLED:"true",CLAUDE_MEM_TIER_SIMPLE_MODEL:"haiku",CLAUDE_MEM_TIER_SUMMARY_MODEL:"",CLAUDE_MEM_CHROMA_ENABLED:"true",CLAUDE_MEM_CHROMA_MODE:"local",CLAUDE_MEM_CHROMA_HOST:"127.0.0.1",CLAUDE_MEM_CHROMA_PORT:"8000",CLAUDE_MEM_CHROMA_SSL:"false",CLAUDE_MEM_CHROMA_API_KEY:"",CLAUDE_MEM_CHROMA_TENANT:"default_tenant",CLAUDE_MEM_CHROMA_DATABASE:"default_database",CLAUDE_MEM_SYNC_ENABLED:"false",CLAUDE_MEM_SYNC_SERVER_URL:"",CLAUDE_MEM_SYNC_API_KEY:"",CLAUDE_MEM_SYNC_AGENT_NAME:"",CLAUDE_MEM_SYNC_INTERVAL_MS:"30000",CLAUDE_MEM_SYNC_TIMEOUT_MS:"3000",CLAUDE_MEM_SYNC_MAX_RETRIES:"5",CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED:"true",CLAUDE_MEM_LEARNING_CONFIDENCE_THRESHOLD:"0.9",CLAUDE_MEM_LEARNING_LLM_MODEL:"gpt-4o-mini",CLAUDE_MEM_LEARNING_LLM_PROVIDER:"openai",CLAUDE_MEM_LEARNING_MAX_PER_SESSION:"10",CLAUDE_MEM_LEARNING_EXTRACTION_MAX_RETRIES:"3",CLAUDE_MEM_OPENAI_API_KEY:"",CLAUDE_MEM_ANTHROPIC_API_KEY:"",CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED:"false"};static getAllDefaults(){return{...this.DEFAULTS}}static get(e){return process.env[e]??this.DEFAULTS[e]}static getInt(e){let t=this.get(e);return parseInt(t,10)}static getBool(e){let t=this.get(e);return t==="true"||t===!0}static applyEnvOverrides(e){let t={...e};for(let s of Object.keys(this.DEFAULTS))process.env[s]!==void 0&&(t[s]=process.env[s]);return t}static loadFromFile(e){try{if(!(0,I.existsSync)(e)){let o=this.getAllDefaults();try{let a=(0,v.dirname)(e);(0,I.existsSync)(a)||(0,I.mkdirSync)(a,{recursive:!0}),(0,I.writeFileSync)(e,JSON.stringify(o,null,2),"utf-8"),console.log("[SETTINGS] Created settings file with defaults:",e)}catch(a){console.warn("[SETTINGS] Failed to create settings file, using in-memory defaults:",e,a)}return this.applyEnvOverrides(o)}let t=(0,I.readFileSync)(e,"utf-8"),s=JSON.parse(t),n=s;if(s.env&&typeof s.env=="object"){n=s.env;try{(0,I.writeFileSync)(e,JSON.stringify(n,null,2),"utf-8"),console.log("[SETTINGS] Migrated settings file from nested to flat schema:",e)}catch(o){console.warn("[SETTINGS] Failed to auto-migrate settings file:",e,o)}}let i={...this.DEFAULTS};for(let o of Object.keys(this.DEFAULTS))if(n[o]!==void 0){let a=n[o];i[o]=a===!0?"true":a===!1?"false":a}return this.applyEnvOverrides(i)}catch(t){return console.warn("[SETTINGS] Failed to load settings, using defaults:",e,t),this.applyEnvOverrides(this.getAllDefaults())}}};var U=require("fs"),j=require("path");var A=class r{static instance=null;activeMode=null;modesDir;constructor(){let e=fe(),t=[(0,j.join)(e,"modes"),(0,j.join)(e,"..","plugin","modes")],s=t.find(n=>(0,U.existsSync)(n));this.modesDir=s||t[0]}static getInstance(){return r.instance||(r.instance=new r),r.instance}parseInheritance(e){let t=e.split("--");if(t.length===1)return{hasParent:!1,parentId:"",overrideId:""};if(t.length>2)throw new Error(`Invalid mode inheritance: ${e}. Only one level of inheritance supported (parent--override)`);return{hasParent:!0,parentId:t[0],overrideId:e}}isPlainObject(e){return e!==null&&typeof e=="object"&&!Array.isArray(e)}deepMerge(e,t){let s={...e};for(let n in t){let i=t[n],o=e[n];this.isPlainObject(i)&&this.isPlainObject(o)?s[n]=this.deepMerge(o,i):s[n]=i}return s}loadModeFile(e){let t=(0,j.join)(this.modesDir,`${e}.json`);if(!(0,U.existsSync)(t))throw new Error(`Mode file not found: ${t}`);let s=(0,U.readFileSync)(t,"utf-8");return JSON.parse(s)}loadMode(e){let t=this.parseInheritance(e);if(!t.hasParent)try{let d=this.loadModeFile(e);return this.activeMode=d,u.debug("SYSTEM",`Loaded mode: ${d.name} (${e})`,void 0,{types:d.observation_types.map(c=>c.id),concepts:d.observation_concepts.map(c=>c.id)}),d}catch{if(u.warn("SYSTEM",`Mode file not found: ${e}, falling back to 'code'`),e==="code")throw new Error("Critical: code.json mode file missing");return this.loadMode("code")}let{parentId:s,overrideId:n}=t,i;try{i=this.loadMode(s)}catch{u.warn("SYSTEM",`Parent mode '${s}' not found for ${e}, falling back to 'code'`),i=this.loadMode("code")}let o;try{o=this.loadModeFile(n),u.debug("SYSTEM",`Loaded override file: ${n} for parent ${s}`)}catch{return u.warn("SYSTEM",`Override file '${n}' not found, using parent mode '${s}' only`),this.activeMode=i,i}if(!o)return u.warn("SYSTEM",`Invalid override file: ${n}, using parent mode '${s}' only`),this.activeMode=i,i;let a=this.deepMerge(i,o);return this.activeMode=a,u.debug("SYSTEM",`Loaded mode with inheritance: ${a.name} (${e} = ${s} + ${n})`,void 0,{parent:s,override:n,types:a.observation_types.map(d=>d.id),concepts:a.observation_concepts.map(d=>d.id)}),a}getActiveMode(){if(!this.activeMode)throw new Error("No mode loaded. Call loadMode() first.");return this.activeMode}getObservationTypes(){return this.getActiveMode().observation_types}getObservationConcepts(){return this.getActiveMode().observation_concepts}getTypeIcon(e){return this.getObservationTypes().find(s=>s.id===e)?.emoji||"\u{1F4DD}"}getWorkEmoji(e){return this.getObservationTypes().find(s=>s.id===e)?.work_emoji||"\u{1F4DD}"}validateType(e){return this.getObservationTypes().some(t=>t.id===e)}getTypeLabel(e){return this.getObservationTypes().find(s=>s.id===e)?.label||e}};function ee(){let r=Le.default.join((0,Ce.homedir)(),".engram","settings.json"),e=G.loadFromFile(r),t=A.getInstance().getActiveMode(),s=new Set(t.observation_types.map(i=>i.id)),n=new Set(t.observation_concepts.map(i=>i.id));return{totalObservationCount:parseInt(e.CLAUDE_MEM_CONTEXT_OBSERVATIONS,10),fullObservationCount:parseInt(e.CLAUDE_MEM_CONTEXT_FULL_COUNT,10),sessionCount:parseInt(e.CLAUDE_MEM_CONTEXT_SESSION_COUNT,10),showReadTokens:e.CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS==="true",showWorkTokens:e.CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS==="true",showSavingsAmount:e.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT==="true",showSavingsPercent:e.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT==="true",observationTypes:s,observationConcepts:n,fullObservationField:e.CLAUDE_MEM_CONTEXT_FULL_FIELD,showLastSummary:e.CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY==="true",showLastMessage:e.CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE==="true"}}var _={reset:"\x1B[0m",bright:"\x1B[1m",dim:"\x1B[2m",cyan:"\x1B[36m",green:"\x1B[32m",yellow:"\x1B[33m",blue:"\x1B[34m",magenta:"\x1B[35m",gray:"\x1B[90m",red:"\x1B[31m"},Me=4,te=1;function se(r){let e=(r.title?.length||0)+(r.subtitle?.length||0)+(r.narrative?.length||0)+JSON.stringify(r.facts||[]).length;return Math.ceil(e/Me)}function re(r){let e=r.length,t=r.reduce((o,a)=>o+se(a),0),s=r.reduce((o,a)=>o+(a.discovery_tokens||0),0),n=s-t,i=s>0?Math.round(n/s*100):0;return{totalObservations:e,totalReadTokens:t,totalDiscoveryTokens:s,savings:n,savingsPercent:i}}function $t(r){return A.getInstance().getWorkEmoji(r)}function x(r,e){let t=se(r),s=r.discovery_tokens||0,n=$t(r.type),i=s>0?`${n} ${s.toLocaleString()}`:"-";return{readTokens:t,discoveryTokens:s,discoveryDisplay:i,workEmoji:n}}function B(r){return r.showReadTokens||r.showWorkTokens||r.showSavingsAmount||r.showSavingsPercent}var ye=D(require("path"),1),W=require("fs");var De=/<system-reminder>[\s\S]*?<\/system-reminder>/g;function ne(r,e,t,s){let n=Array.from(t.observationTypes),i=n.map(()=>"?").join(","),o=Array.from(t.observationConcepts),a=o.map(()=>"?").join(",");return r.db.prepare(`
    SELECT
      o.id,
      o.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      o.type,
      o.title,
      o.subtitle,
      o.narrative,
      o.facts,
      o.concepts,
      o.files_read,
      o.files_modified,
      o.discovery_tokens,
      o.created_at,
      o.created_at_epoch
    FROM observations o
    LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
    WHERE o.project = ?
      AND type IN (${i})
      AND EXISTS (
        SELECT 1 FROM json_each(o.concepts)
        WHERE value IN (${a})
      )
      ${s?"AND COALESCE(s.platform_source, 'claude') = ?":""}
    ORDER BY o.created_at_epoch DESC
    LIMIT ?
  `).all(e,...n,...o,...s?[s]:[],t.totalObservationCount)}function ie(r,e,t,s){return r.db.prepare(`
    SELECT
      ss.id,
      ss.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      ss.request,
      ss.investigated,
      ss.learned,
      ss.completed,
      ss.next_steps,
      ss.created_at,
      ss.created_at_epoch
    FROM session_summaries ss
    LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
    WHERE ss.project = ?
      ${s?"AND COALESCE(s.platform_source, 'claude') = ?":""}
    ORDER BY ss.created_at_epoch DESC
    LIMIT ?
  `).all(e,...s?[s]:[],t.sessionCount+te)}function ve(r,e,t,s){let n=Array.from(t.observationTypes),i=n.map(()=>"?").join(","),o=Array.from(t.observationConcepts),a=o.map(()=>"?").join(","),d=e.map(()=>"?").join(",");return r.db.prepare(`
    SELECT
      o.id,
      o.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      o.type,
      o.title,
      o.subtitle,
      o.narrative,
      o.facts,
      o.concepts,
      o.files_read,
      o.files_modified,
      o.discovery_tokens,
      o.created_at,
      o.created_at_epoch,
      o.project
    FROM observations o
    LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
    WHERE o.project IN (${d})
      AND type IN (${i})
      AND EXISTS (
        SELECT 1 FROM json_each(o.concepts)
        WHERE value IN (${a})
      )
      ${s?"AND COALESCE(s.platform_source, 'claude') = ?":""}
    ORDER BY o.created_at_epoch DESC
    LIMIT ?
  `).all(...e,...n,...o,...s?[s]:[],t.totalObservationCount)}function Ue(r,e,t,s){let n=e.map(()=>"?").join(",");return r.db.prepare(`
    SELECT
      ss.id,
      ss.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      ss.request,
      ss.investigated,
      ss.learned,
      ss.completed,
      ss.next_steps,
      ss.created_at,
      ss.created_at_epoch,
      ss.project
    FROM session_summaries ss
    LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
    WHERE ss.project IN (${n})
      ${s?"AND COALESCE(s.platform_source, 'claude') = ?":""}
    ORDER BY ss.created_at_epoch DESC
    LIMIT ?
  `).all(...e,...s?[s]:[],t.sessionCount+te)}function Xt(r){return r.replace(/\//g,"-")}function Ht(r){try{if(!(0,W.existsSync)(r))return{userMessage:"",assistantMessage:""};let e=(0,W.readFileSync)(r,"utf-8").trim();if(!e)return{userMessage:"",assistantMessage:""};let t=e.split(`
`).filter(n=>n.trim()),s="";for(let n=t.length-1;n>=0;n--)try{let i=t[n];if(!i.includes('"type":"assistant"'))continue;let o=JSON.parse(i);if(o.type==="assistant"&&o.message?.content&&Array.isArray(o.message.content)){let a="";for(let d of o.message.content)d.type==="text"&&(a+=d.text);if(a=a.replace(De,"").trim(),a){s=a;break}}}catch(i){u.debug("PARSER","Skipping malformed transcript line",{lineIndex:n},i);continue}return{userMessage:"",assistantMessage:s}}catch(e){return u.failure("WORKER","Failed to extract prior messages from transcript",{transcriptPath:r},e),{userMessage:"",assistantMessage:""}}}function oe(r,e,t,s){if(!e.showLastMessage||r.length===0)return{userMessage:"",assistantMessage:""};let n=r.find(d=>d.memory_session_id!==t);if(!n)return{userMessage:"",assistantMessage:""};let i=n.memory_session_id,o=Xt(s),a=ye.default.join(C,"projects",o,`${i}.jsonl`);return Ht(a)}function xe(r,e){let t=e[0]?.id;return r.map((s,n)=>{let i=n===0?null:e[n+1];return{...s,displayEpoch:i?i.created_at_epoch:s.created_at_epoch,displayTime:i?i.created_at:s.created_at,shouldShowLink:s.id!==t}})}function ae(r,e){let t=[...r.map(s=>({type:"observation",data:s})),...e.map(s=>({type:"summary",data:s}))];return t.sort((s,n)=>{let i=s.type==="observation"?s.data.created_at_epoch:s.data.displayEpoch,o=n.type==="observation"?n.data.created_at_epoch:n.data.displayEpoch;return i-o}),t}function ke(r,e){return new Set(r.slice(0,e).map(t=>t.id))}function Fe(){let r=new Date,e=r.toLocaleDateString("en-CA"),t=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function we(r){return[`# $CMEM ${r} ${Fe()}`,""]}function Pe(){return[`Legend: \u{1F3AF}session ${A.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji}${t.id}`).join(" ")}`,"Format: ID TIME TYPE TITLE","Fetch details: get_observations([IDs]) | Search: mem-search skill",""]}function $e(){return[]}function Xe(){return[]}function He(r,e){let t=[],s=[`${r.totalObservations} obs (${r.totalReadTokens.toLocaleString()}t read)`,`${r.totalDiscoveryTokens.toLocaleString()}t work`];return r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)&&(e.showSavingsPercent?s.push(`${r.savingsPercent}% savings`):e.showSavingsAmount&&s.push(`${r.savings.toLocaleString()}t saved`)),t.push(`Stats: ${s.join(" | ")}`),t.push(""),t}function Ge(r){return[`### ${r}`]}function je(r){return r.toLowerCase().replace(" am","a").replace(" pm","p")}function Be(r,e,t){let s=r.title||"Untitled",n=A.getInstance().getTypeIcon(r.type),i=e?je(e):'"';return`${r.id} ${i} ${n} ${s}`}function We(r,e,t,s){let n=[],i=r.title||"Untitled",o=A.getInstance().getTypeIcon(r.type),a=e?je(e):'"',{readTokens:d,discoveryDisplay:c}=x(r,s);n.push(`**${r.id}** ${a} ${o} **${i}**`),t&&n.push(t);let E=[];return s.showReadTokens&&E.push(`~${d}t`),s.showWorkTokens&&E.push(c),E.length>0&&n.push(E.join(" ")),n.push(""),n}function Ye(r,e){return[`S${r.id} ${r.request||"Session started"} (${e})`]}function k(r,e){return e?[`**${r}**: ${e}`,""]:[]}function qe(r){return r.assistantMessage?["","---","","**Previously**","",`A: ${r.assistantMessage}`,""]:[]}function Ve(r,e){return["",`Access ${Math.round(r/1e3)}k tokens of past work via get_observations([IDs]) or mem-search skill.`]}function Ke(r){return`# $CMEM ${r} ${Fe()}

No previous sessions found.`}function Je(){let r=new Date,e=r.toLocaleDateString("en-CA"),t=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function Qe(r){return["",`${_.bright}${_.cyan}[${r}] recent context, ${Je()}${_.reset}`,`${_.gray}${"\u2500".repeat(60)}${_.reset}`,""]}function ze(){let e=A.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji} ${t.id}`).join(" | ");return[`${_.dim}Legend: session-request | ${e}${_.reset}`,""]}function Ze(){return[`${_.bright}Column Key${_.reset}`,`${_.dim}  Read: Tokens to read this observation (cost to learn it now)${_.reset}`,`${_.dim}  Work: Tokens spent on work that produced this record ( research, building, deciding)${_.reset}`,""]}function et(){return[`${_.dim}Context Index: This semantic index (titles, types, files, tokens) is usually sufficient to understand past work.${_.reset}`,"",`${_.dim}When you need implementation details, rationale, or debugging context:${_.reset}`,`${_.dim}  - Fetch by ID: get_observations([IDs]) for observations visible in this index${_.reset}`,`${_.dim}  - Search history: Use the mem-search skill for past decisions, bugs, and deeper research${_.reset}`,`${_.dim}  - Trust this index over re-reading code for past decisions and learnings${_.reset}`,""]}function tt(r,e){let t=[];if(t.push(`${_.bright}${_.cyan}Context Economics${_.reset}`),t.push(`${_.dim}  Loading: ${r.totalObservations} observations (${r.totalReadTokens.toLocaleString()} tokens to read)${_.reset}`),t.push(`${_.dim}  Work investment: ${r.totalDiscoveryTokens.toLocaleString()} tokens spent on research, building, and decisions${_.reset}`),r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)){let s="  Your savings: ";e.showSavingsAmount&&e.showSavingsPercent?s+=`${r.savings.toLocaleString()} tokens (${r.savingsPercent}% reduction from reuse)`:e.showSavingsAmount?s+=`${r.savings.toLocaleString()} tokens`:s+=`${r.savingsPercent}% reduction from reuse`,t.push(`${_.green}${s}${_.reset}`)}return t.push(""),t}function st(r){return[`${_.bright}${_.cyan}${r}${_.reset}`,""]}function rt(r){return[`${_.dim}${r}${_.reset}`]}function nt(r,e,t,s){let n=r.title||"Untitled",i=A.getInstance().getTypeIcon(r.type),{readTokens:o,discoveryTokens:a,workEmoji:d}=x(r,s),c=t?`${_.dim}${e}${_.reset}`:" ".repeat(e.length),E=s.showReadTokens&&o>0?`${_.dim}(~${o}t)${_.reset}`:"",p=s.showWorkTokens&&a>0?`${_.dim}(${d} ${a.toLocaleString()}t)${_.reset}`:"";return`  ${_.dim}#${r.id}${_.reset}  ${c}  ${i}  ${n} ${E} ${p}`}function it(r,e,t,s,n){let i=[],o=r.title||"Untitled",a=A.getInstance().getTypeIcon(r.type),{readTokens:d,discoveryTokens:c,workEmoji:E}=x(r,n),p=t?`${_.dim}${e}${_.reset}`:" ".repeat(e.length),l=n.showReadTokens&&d>0?`${_.dim}(~${d}t)${_.reset}`:"",g=n.showWorkTokens&&c>0?`${_.dim}(${E} ${c.toLocaleString()}t)${_.reset}`:"";return i.push(`  ${_.dim}#${r.id}${_.reset}  ${p}  ${a}  ${_.bright}${o}${_.reset}`),s&&i.push(`    ${_.dim}${s}${_.reset}`),(l||g)&&i.push(`    ${l} ${g}`),i.push(""),i}function ot(r,e){let t=`${r.request||"Session started"} (${e})`;return[`${_.yellow}#S${r.id}${_.reset} ${t}`,""]}function F(r,e,t){return e?[`${t}${r}:${_.reset} ${e}`,""]:[]}function at(r){return r.assistantMessage?["","---","",`${_.bright}${_.magenta}Previously${_.reset}`,"",`${_.dim}A: ${r.assistantMessage}${_.reset}`,""]:[]}function dt(r,e){let t=Math.round(r/1e3);return["",`${_.dim}Access ${t}k tokens of past research & decisions for just ${e.toLocaleString()}t. Use the claude-mem skill to access memories by ID.${_.reset}`]}function _t(r){return`
${_.bright}${_.cyan}[${r}] recent context, ${Je()}${_.reset}
${_.gray}${"\u2500".repeat(60)}${_.reset}

${_.dim}No previous sessions found for this project yet.${_.reset}
`}function ut(r,e,t,s){let n=[];return s?n.push(...Qe(r)):n.push(...we(r)),s?n.push(...ze()):n.push(...Pe()),s?n.push(...Ze()):n.push(...$e()),s?n.push(...et()):n.push(...Xe()),B(t)&&(s?n.push(...tt(e,t)):n.push(...He(e,t))),n}var de=D(require("path"),1);function V(r){if(!r)return[];try{let e=JSON.parse(r);return Array.isArray(e)?e:[]}catch(e){return u.debug("PARSER","Failed to parse JSON array, using empty fallback",{preview:r?.substring(0,50)},e),[]}}function _e(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:!0})}function ue(r){return new Date(r).toLocaleString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0})}function Et(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric"})}function ct(r,e){return de.default.isAbsolute(r)?de.default.relative(e,r):r}function mt(r,e,t){let s=V(r);if(s.length>0)return ct(s[0],e);if(t){let n=V(t);if(n.length>0)return ct(n[0],e)}return"General"}function Gt(r){let e=new Map;for(let s of r){let n=s.type==="observation"?s.data.created_at:s.data.displayTime,i=Et(n);e.has(i)||e.set(i,[]),e.get(i).push(s)}let t=Array.from(e.entries()).sort((s,n)=>{let i=new Date(s[0]).getTime(),o=new Date(n[0]).getTime();return i-o});return new Map(t)}function pt(r,e){return e.fullObservationField==="narrative"?r.narrative:r.facts?V(r.facts).join(`
`):null}function jt(r,e,t,s){let n=[];n.push(...Ge(r));let i="";for(let o of e)if(o.type==="summary"){let a=o.data,d=_e(a.displayTime);n.push(...Ye(a,d))}else{let a=o.data,d=ue(a.created_at),E=d!==i?d:"";if(i=d,t.has(a.id)){let l=pt(a,s);n.push(...We(a,E,l,s))}else n.push(Be(a,E,s))}return n}function Bt(r,e,t,s,n){let i=[];i.push(...st(r));let o=null,a="";for(let d of e)if(d.type==="summary"){o=null,a="";let c=d.data,E=_e(c.displayTime);i.push(...ot(c,E))}else{let c=d.data,E=mt(c.files_modified,n,c.files_read),p=ue(c.created_at),l=p!==a;a=p;let g=t.has(c.id);if(E!==o&&(i.push(...rt(E)),o=E),g){let f=pt(c,s);i.push(...it(c,p,l,f,s))}else i.push(nt(c,p,l,s))}return i.push(""),i}function Wt(r,e,t,s,n,i){return i?Bt(r,e,t,s,n):jt(r,e,t,s)}function lt(r,e,t,s,n){let i=[],o=Gt(r);for(let[a,d]of o)i.push(...Wt(a,d,e,t,s,n));return i}function Tt(r,e,t){return!(!r.showLastSummary||!e||!!!(e.investigated||e.learned||e.completed||e.next_steps)||t&&e.created_at_epoch<=t.created_at_epoch)}function gt(r,e){let t=[];return e?(t.push(...F("Investigated",r.investigated,_.blue)),t.push(...F("Learned",r.learned,_.yellow)),t.push(...F("Completed",r.completed,_.green)),t.push(...F("Next Steps",r.next_steps,_.magenta))):(t.push(...k("Investigated",r.investigated)),t.push(...k("Learned",r.learned)),t.push(...k("Completed",r.completed)),t.push(...k("Next Steps",r.next_steps))),t}function St(r,e){return e?at(r):qe(r)}function ft(r,e,t){return!B(e)||r.totalDiscoveryTokens<=0||r.savings<=0?[]:t?dt(r.totalDiscoveryTokens,r.totalReadTokens):Ve(r.totalDiscoveryTokens,r.totalReadTokens)}function Yt(r,e){try{return r.db.prepare(`
      SELECT tried, wrong_because, fix, trigger_context
      FROM corrections
      WHERE project = ? AND trigger_context != ''
      ORDER BY weight_multiplier DESC, created_at DESC
      LIMIT 10
    `).all(e)}catch{return[]}}function qt(r,e){if(!e||r.length===0)return r.slice(0,3);let t=new Set(e.toLowerCase().split(/\W+/).filter(s=>s.length>3));return r.map(s=>({correction:s,score:s.trigger_context.toLowerCase().split(/\W+/).filter(n=>t.has(n)).length})).sort((s,n)=>n.score-s.score).slice(0,3).map(s=>s.correction)}function Vt(r){return r.length===0?"":`
## PAST CORRECTIONS (high priority)
${r.map(t=>`- Tried: ${t.tried}. Wrong because: ${t.wrong_because}. Fix: ${t.fix}.
  [Context: ${t.trigger_context}]`).join(`
`)}
`}var Kt=bt.default.join((0,ht.homedir)(),".claude","plugins","marketplaces","thedotmack","plugin",".install-version");function Jt(){try{return new H}catch(r){if(r.code==="ERR_DLOPEN_FAILED"){try{(0,Nt.unlinkSync)(Kt)}catch(e){u.debug("SYSTEM","Marker file cleanup failed (may not exist)",{},e)}return u.error("SYSTEM","Native module rebuild needed - restart Claude Code to auto-fix"),null}throw r}}function Qt(r,e){return e?_t(r):Ke(r)}function zt(r,e,t,s,n,i,o){let a=[],d=re(e);a.push(...ut(r,d,s,o));let c=t.slice(0,s.sessionCount),E=xe(c,t),p=ae(e,E),l=ke(e,s.fullObservationCount);a.push(...lt(p,l,s,n,o));let g=t[0],f=e[0];Tt(s,g,f)&&a.push(...gt(g,o));let O=oe(e,s,i,n);return a.push(...St(O,o)),a.push(...ft(d,s,o)),a.join(`
`).trimEnd()}async function ce(r,e=!1){let t=ee(),s=r?.cwd??process.cwd(),n=Ie(s),i=r?.platform_source,o=r?.projects||[n];r?.full&&(t.totalObservationCount=999999,t.sessionCount=999999);let a=Jt();if(!a)return"";try{let d=o.length>1?ve(a,o,t,i):ne(a,n,t,i),c=o.length>1?Ue(a,o,t,i):ie(a,n,t,i);if(d.length===0&&c.length===0)return Qt(n,e);let E=Yt(a,n),p=d[0]?.title??"",l=qt(E,p),g=Vt(l),f=zt(n,d,c,t,s,r?.session_id,e);return g+f}finally{a.close()}}0&&(module.exports={generateContext});
