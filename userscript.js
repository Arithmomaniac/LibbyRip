// ==UserScript==
// @name          LibreGRAB
// @namespace     http://tampermonkey.net/
// @version       2026-01-09
// @description   Download all the booty!
// @author        PsychedelicPalimpsest
// @license       MIT
// @supportURL    https://github.com/PsychedelicPalimpsest/LibbyRip/issues
// @match         *://*.listen.libbyapp.com/*
// @match         *://*.listen.overdrive.com/*
// @match         *://*.read.libbyapp.com/?*
// @match         *://*.read.overdrive.com/?*
// @run-at        document-start
// @icon          https://www.google.com/s2/favicons?sz=64&domain=libbyapp.com
// @require       https://unpkg.com/client-zip@2.5.0/worker.js
// @require       https://cdn.jsdelivr.net/npm/idb-keyval@6/dist/umd.js
// @grant         GM_xmlhttpRequest
// @grant         unsafeWindow
// ==/UserScript==

(()=>{

    const FFMPEG_CORE_VERSION = "0.12.10";
    const FFMPEG_CORE_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
    const ffmpegCacheStore = idbKeyval.createStore('libregrip-ffmpeg-cache', 'bundles');

    // Fetch via GM_xmlhttpRequest (bypasses CORS/CSP)
    function gmFetch(url, responseType = 'text') {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType,
                onload: (resp) => resolve(responseType === 'arraybuffer' ? resp.response : resp.responseText),
                onerror: (err) => reject(new Error(`GM_xmlhttpRequest failed: ${err.statusText || 'unknown'}`)),
            });
        });
    }

    // Fetch as blob URL, with IDB caching
    async function cachedFetchBlobURL(url, cacheKey, mimeType, versionMatch) {
        if (versionMatch) {
            try {
                const t0 = performance.now();
                const cached = await idbKeyval.get(cacheKey, ffmpegCacheStore);
                if (cached) {
                    const blobUrl = URL.createObjectURL(new Blob([cached], { type: mimeType }));
                    console.log(`LibreGRAB: ${cacheKey} from IDB (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
                    return blobUrl;
                }
            } catch (e) {
                console.warn(`LibreGRAB: IDB read failed for ${cacheKey}`, e);
            }
        }

        console.log(`LibreGRAB: Downloading ${cacheKey}...`);
        const isWasm = mimeType === 'application/wasm';
        const data = await gmFetch(url, isWasm ? 'arraybuffer' : 'text');

        try {
            await idbKeyval.set(cacheKey, data, ffmpegCacheStore);
            await idbKeyval.set('ffmpeg-core-version', FFMPEG_CORE_VERSION, ffmpegCacheStore);
        } catch (e) {
            console.warn(`LibreGRAB: IDB write failed for ${cacheKey}`, e);
        }

        return URL.createObjectURL(new Blob([data], { type: mimeType }));
    }

    // Inlined worker — self-contained, no external imports
    const WORKER_CODE = `
const FFMessageType = {LOAD:"LOAD",EXEC:"EXEC",FFPROBE:"FFPROBE",WRITE_FILE:"WRITE_FILE",READ_FILE:"READ_FILE",DELETE_FILE:"DELETE_FILE",RENAME:"RENAME",CREATE_DIR:"CREATE_DIR",LIST_DIR:"LIST_DIR",DELETE_DIR:"DELETE_DIR",ERROR:"ERROR",DOWNLOAD:"DOWNLOAD",PROGRESS:"PROGRESS",LOG:"LOG",MOUNT:"MOUNT",UNMOUNT:"UNMOUNT"};
let ffmpeg;
const load = async ({ coreURL: _coreURL, wasmURL: _wasmURL, workerURL: _workerURL }) => {
    const first = !ffmpeg;
    try { importScripts(_coreURL); }
    catch (e) { throw new Error("failed to import ffmpeg-core.js: " + e.message); }
    const coreURL = _coreURL;
    const wasmURL = _wasmURL ? _wasmURL : _coreURL.replace(/.js$/g,".wasm");
    const workerURL = _workerURL ? _workerURL : _coreURL.replace(/.js$/g,".worker.js");
    ffmpeg = await self.createFFmpegCore({ mainScriptUrlOrBlob: coreURL+"#"+btoa(JSON.stringify({wasmURL,workerURL})) });
    ffmpeg.setLogger((data)=>self.postMessage({type:FFMessageType.LOG,data}));
    ffmpeg.setProgress((data)=>self.postMessage({type:FFMessageType.PROGRESS,data}));
    return first;
};
const exec = ({args,timeout=-1})=>{ffmpeg.setTimeout(timeout);ffmpeg.exec(...args);const ret=ffmpeg.ret;ffmpeg.reset();return ret;};
const ffprobe = ({args,timeout=-1})=>{ffmpeg.setTimeout(timeout);ffmpeg.ffprobe(...args);const ret=ffmpeg.ret;ffmpeg.reset();return ret;};
const writeFile = ({path,data})=>{ffmpeg.FS.writeFile(path,data);return true;};
const readFile = ({path,encoding})=>ffmpeg.FS.readFile(path,{encoding});
const deleteFile = ({path})=>{ffmpeg.FS.unlink(path);return true;};
const rename = ({oldPath,newPath})=>{ffmpeg.FS.rename(oldPath,newPath);return true;};
const createDir = ({path})=>{ffmpeg.FS.mkdir(path);return true;};
const listDir = ({path})=>{const names=ffmpeg.FS.readdir(path);const nodes=[];for(const name of names){const stat=ffmpeg.FS.stat(path+"/"+name);nodes.push({name,isDir:ffmpeg.FS.isDir(stat.mode)});}return nodes;};
const deleteDir = ({path})=>{ffmpeg.FS.rmdir(path);return true;};
const mount = ({fsType,options,mountPoint})=>{const fs=ffmpeg.FS.filesystems[fsType];if(!fs)return false;ffmpeg.FS.mount(fs,options,mountPoint);return true;};
const unmount = ({mountPoint})=>{ffmpeg.FS.unmount(mountPoint);return true;};
self.onmessage = async ({data:{id,type,data:_data}})=>{
    const trans=[];let data;
    try{
        if(type!=="LOAD"&&!ffmpeg)throw new Error("ffmpeg is not loaded");
        switch(type){
            case "LOAD":data=await load(_data);break;
            case "EXEC":data=exec(_data);break;
            case "FFPROBE":data=ffprobe(_data);break;
            case "WRITE_FILE":data=writeFile(_data);break;
            case "READ_FILE":data=readFile(_data);break;
            case "DELETE_FILE":data=deleteFile(_data);break;
            case "RENAME":data=rename(_data);break;
            case "CREATE_DIR":data=createDir(_data);break;
            case "LIST_DIR":data=listDir(_data);break;
            case "DELETE_DIR":data=deleteDir(_data);break;
            case "MOUNT":data=mount(_data);break;
            case "UNMOUNT":data=unmount(_data);break;
            default:throw new Error("unknown message type");
        }
    }catch(e){self.postMessage({id,type:"ERROR",data:e.toString()});return;}
    if(data instanceof Uint8Array)trans.push(data.buffer);
    self.postMessage({id,type,data},trans);
};
`;

    // Load and initialize official @ffmpeg/ffmpeg
    async function loadFFmpeg() {
        const t0 = performance.now();

        let versionMatch = false;
        try {
            const v = await idbKeyval.get('ffmpeg-core-version', ffmpegCacheStore);
            versionMatch = v === FFMPEG_CORE_VERSION;
        } catch (e) {}

        // Fetch core JS via GM_xmlhttpRequest (bypasses CSP), create blob URL
        // Worker will importScripts(blobURL) — works because blob is same-origin
        const coreBlobURL = await cachedFetchBlobURL(
            `${FFMPEG_CORE_BASE}/ffmpeg-core.js`, 'ffmpeg-core-js', 'text/javascript', versionMatch
        );

        // WASM uses direct CDN URL so browser can cache compiled module
        const wasmURL = `${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`;

        const workerBlob = URL.createObjectURL(new Blob([WORKER_CODE], { type: 'text/javascript' }));

        // Import the ESM FFmpeg class
        const { FFmpeg } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/+esm');

        console.log(`LibreGRAB: Assets ready in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

        const ffmpegInstance = new FFmpeg();
        console.log(`LibreGRAB: Calling ffmpeg.load()...`);
        const loadT0 = performance.now();
        await ffmpegInstance.load({ coreURL: coreBlobURL, wasmURL, classWorkerURL: workerBlob });
        console.log(`LibreGRAB: ffmpeg.load() took ${((performance.now() - loadT0) / 1000).toFixed(1)}s`);

        return ffmpegInstance;
    }

    let downloadElem;
    const CSS = `
    .pNav{
        background-color: red;
        width: 100%;
        display: flex;
        justify-content: space-between;
    }
    .pLink{
        color: blue;
        text-decoration-line: underline;
        padding: .25em;
        font-size: 1em;
    }
    .foldMenu{
        position: absolute;
        width: 100%;
        height: 0%;
        z-index: 1000;

        background-color: grey;
        color: white;

        overflow-x: hidden;
        overflow-y: scroll;

        transition: height 0.3s
    }
    .active{
        height: 40%;
        border: double;
    }
    .pChapLabel{
        font-size: 2em;
    }`;
    /* =========================================
              BEGIN AUDIOBOOK SECTION!
       =========================================
    */


    // Libby, somewhere, gets the crypto stuff we need for mp3 urls, then removes it before adding it to the BIF.
    // here, we simply hook json parse to get it for us!

    const old_parse = JSON.parse;
    let odreadCmptParams = null;
    JSON.parse = function(...args){
        let ret = old_parse(...args);
        if (typeof(ret) == "object" && ret["b"] != undefined && ret["b"]["-odread-cmpt-params"] != undefined){
            odreadCmptParams = Array.from(ret["b"]["-odread-cmpt-params"]);
        }

        return ret;
    }



    const audioBookNav = `
        <a class="pLink" id="chap"> <h1> View chapters </h1> </a>
        <a class="pLink" id="down"> <h1> Export as MP3 </h1> </a>
        <a class="pLink" id="exp"> <h1> Export audiobook </h1> </a>
    `;
    const chaptersMenu = `
        <h2>This book contains {CHAPTERS} chapters.</h2>
        <button class="shibui-button" style="background-color: white" id="dumpAll"> Download all </button><br>
    `;
    let chapterMenuElem;

    function buildPirateUi(){
        // Create the nav
        let nav = document.createElement("div");
        nav.innerHTML = audioBookNav;
        nav.querySelector("#chap").onclick = viewChapters;
        nav.querySelector("#down").onclick = exportMP3;
        nav.querySelector("#exp").onclick = exportChapters;
        nav.classList.add("pNav");
        let pbar = document.querySelector(".nav-progress-bar");
        pbar.insertBefore(nav, pbar.children[1]);

        // Create the chapters menu
        chapterMenuElem = document.createElement("div");
        chapterMenuElem.classList.add("foldMenu");
        chapterMenuElem.setAttribute("tabindex", "-1"); // Don't mess with tab key
        const urls = getUrls();

        chapterMenuElem.innerHTML = chaptersMenu.replace("{CHAPTERS}", urls.length);
        document.body.appendChild(chapterMenuElem);

        downloadElem = document.createElement("div");
        downloadElem.classList.add("foldMenu");
        downloadElem.setAttribute("tabindex", "-1"); // Don't mess with tab key
        document.body.appendChild(downloadElem);
    }
    function getUrls(){
        let ret = [];
        for (let spine of BIF.objects.spool.components){
            let data = {

                url: location.origin + "/" + spine.meta.path + "?" + odreadCmptParams[spine.spinePosition],
                index : spine.meta["-odread-spine-position"],
                duration: spine.meta["audio-duration"],
                size: spine.meta["-odread-file-bytes"],
                type: spine.meta["media-type"]
            };
            ret.push(data);
        }
        return ret;
    }
    function paddy(num, padlen, padchar) {
        var pad_char = typeof padchar !== 'undefined' ? padchar : '0';
        var pad = new Array(1 + padlen).join(pad_char);
        return (pad + num).slice(-pad.length);
    }
    let firstChapClick = true;
    function viewChapters(){
        // Populate chapters ONLY after first viewing
        if (firstChapClick){
            firstChapClick = false;
            for (let url of getUrls()){
                let span = document.createElement("span");
                span.classList.add("pChapLabel")
                span.textContent = "#" + (1 + url.index);

                let audio = document.createElement("audio");
                audio.setAttribute("controls", "");
                let source = document.createElement("source");
                source.setAttribute("src", url.url);
                source.setAttribute("type", url.type);
                audio.appendChild(source);

                chapterMenuElem.appendChild(span);
                chapterMenuElem.appendChild(document.createElement("br"));
                chapterMenuElem.appendChild(audio);
                chapterMenuElem.appendChild(document.createElement("br"));
            }
        }
        if (chapterMenuElem.classList.contains("active"))
            chapterMenuElem.classList.remove("active");
        else
            chapterMenuElem.classList.add("active");
        chapterMenuElem.querySelector("#dumpAll").onclick = async function(){

            chapterMenuElem.querySelector("#dumpAll").style.display = "none";

            await Promise.all(getUrls().map(async function(url){
                const res = await fetch(url.url);
                const blob = await res.blob();

                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `${getAuthorString()} - ${BIF.map.title.main}.${url.index}.mp3`;
                link.click();

                URL.revokeObjectURL(link.href);
            }));

            chapterMenuElem.querySelector("#dumpAll").style.display = "";
        };
    }
    function getAuthorString(){
        return BIF.map.creator.filter(creator => creator.role === 'author').map(creator => creator.name).join(", ");
    }

    function getMetadata(){
        let spineToIndex = BIF.map.spine.map((x)=>x["-odread-original-path"]);
        let metadata = {
            title: BIF.map.title.main,
            description: BIF.map.description,
            coverUrl: BIF.root.querySelector("image").getAttribute("href"),
            creator: BIF.map.creator,
            spine: BIF.map.spine.map((x)=>{return {
                duration: x["audio-duration"],
                type: x["media-type"],
                bitrate: x["audio-bitrate"],
            }})
        };
        if (BIF.map.nav.toc != undefined){
            metadata.chapters = BIF.map.nav.toc.map((rChap)=>{
                return {
                    title: rChap.title,
                    spine: spineToIndex.indexOf(rChap.path.split("#")[0]),
                    offset: 1*(rChap.path.split("#")[1] | 0)
                };
            });
        }
        return metadata;

    }

    async function createMetadata(){
        let metadata = getMetadata();
        const response = await fetch(metadata.coverUrl);
        const blob = await response.blob();
        const csplit = metadata.coverUrl.split(".");
        return [
            {
                name: "metadata/cover." + csplit[csplit.length-1],
                input: blob
            },
            {
                name: "metadata/metadata.json",
                input: JSON.stringify(metadata, null, 2)
            }
        ];
    }
    function generateTOCFFmpeg(metadata){
        if (!metadata.chapters) return null;
        let lastTitle = null;

        const duration = Math.round(BIF.map.spine.map((x)=>x["audio-duration"]).reduce((acc, val) => acc + val)) * 1000000000;

        let toc = ";FFMETADATA1\n\n";

        // Get the offset for each spine element
        let temp = 0;
        const spineSpecificOffset = BIF.map.spine.map((x)=>{
            let old = temp;
            temp += x["audio-duration"]*1;
            return old;
        });

        // Libby chapter split over many mp3s have duplicate chapters, so we must filter them
        // then convert them to be in [title, start_in_nanosecs]
        let chapters = metadata.chapters.filter((x)=>{
            let ret = x.title !== lastTitle;
            lastTitle = x.title;
            return ret;
        }).map((x)=>[
            // Escape the title
            x.title.replaceAll("\\", "\\\\").replaceAll("#", "\\#").replaceAll(";", "\\;").replaceAll("=", "\\=").replaceAll("\n", ""),
            // Calculate absolute offset in nanoseconds
            Math.round(spineSpecificOffset[x.spine] + x.offset) * 1000000000
        ]);

        // Transform chapter to be [title, start_in_nanosecs, end_in_nanosecounds]
        let last = duration;
        for (let i = chapters.length - 1; -1 != i; i--){
            chapters[i].push(last);
            last = chapters[i][1];
        }

        chapters.forEach((x)=>{
            toc += "[CHAPTER]\n";
            toc += `START=${x[1]}\n`;
            toc += `END=${x[2]}\n`;
            toc += `title=${x[0]}\n`;
        });

        return toc;
    }

    let downloadState = -1;
    let ffmpeg = null;
    async function createAndDownloadMp3(urls){
		await initFFmpeg();
        let metadata = getMetadata();
        downloadElem.innerHTML += "Downloading mp3 files <br>";
        await ffmpeg.writeFile("chapters.txt", generateTOCFFmpeg(metadata));


        let fetchPromises = urls.map(async (url) => {
            // Download the mp3
            const response = await fetch(url.url);
            const blob = await response.blob();

            // Dump it into ffmpeg
            await ffmpeg.writeFile((url.index + 1) + ".mp3", new Uint8Array(await blob.arrayBuffer()));


            downloadElem.innerHTML += `Download of disk ${url.index + 1} complete! <br>`
            downloadElem.scrollTo(0, downloadElem.scrollHeight);
        });

        let coverName = null;

        if (metadata.coverUrl){
            console.log(metadata.coverUrl);
            const csplit = metadata.coverUrl.split(".");
            const response = await fetch(metadata.coverUrl);
            const blob = await response.blob();

            coverName = "cover." + csplit[csplit.length-1];

            await ffmpeg.writeFile(coverName, new Uint8Array(await blob.arrayBuffer()));
        }


        await Promise.all(fetchPromises);

        downloadElem.innerHTML += `<br><b>Downloads complete!</b> Now combining them together! (This might take a <b><i>minute</i></b>) <br> Transcode progress: <span id="mp3Progress">0</span> hours in to audiobook<br>`
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        let files = "";

        for (let i = 0; i < urls.length; i++){
            files += `file '${i+1}.mp3'\n`
        }
        await ffmpeg.writeFile("files.txt", files);

        ffmpeg.on('progress', (progress)=>{
            // The progress.time feature seems to be in micro secounds
            downloadElem.querySelector("#mp3Progress").textContent = (progress.time / 1000000 / 3600).toFixed(2);
        });
        ffmpeg.on('log', ({ message }) => console.log(message));

        await ffmpeg.exec([
                           "-y", "-f", "concat",
                           "-i", "files.txt",
                           "-i", "chapters.txt"]
                          .concat(coverName ? ["-i", coverName] : [])
                          .concat([
                            "-map_metadata", "1",
                            "-codec", "copy",
                            "-map", "0:a",
                            "-metadata", `title=${metadata.title}`,
                            "-metadata", `album=${metadata.title}`,
                            "-metadata", `artist=${getAuthorString()}`,
                            "-metadata", `encoded_by=LibbyRip/LibreGRAB`,
                            "-c:a", "copy"])
                          .concat(coverName ? [
                            "-map", "2:v",
                            "-metadata:s:v", "title=Album cover",
                            "-metadata:s:v", "comment=Cover (front)"]
                            : [])
                            .concat(["out.mp3"]));



        const outData = await ffmpeg.readFile("out.mp3");
        let blob_url = URL.createObjectURL(new Blob([outData.buffer || outData]));

        const link = document.createElement('a');
        link.href = blob_url;

        link.download = getAuthorString() + ' - ' + BIF.map.title.main + '.mp3';
        document.body.appendChild(link);
        link.click();
        link.remove();

        downloadState = -1;
        downloadElem.innerHTML = ""
        downloadElem.classList.remove("active");

        // Clean up the object URL
        setTimeout(() => URL.revokeObjectURL(blob_url), 100);

    }

	let ffmpegInitPromise = null;

	async function initFFmpeg() {
		console.log("initFFmpeg");
		if (ffmpegInitPromise) return ffmpegInitPromise;
		ffmpegInitPromise = (async () => {
			if (!ffmpeg) {
				downloadElem.innerHTML += "Initializing FFmpeg.wasm<br>";
				console.log("Initializing FFmpeg.wasm");
				ffmpeg = await loadFFmpeg();
				downloadElem.innerHTML += "FFmpeg.wasm initialized<br>";
				console.log("FFmpeg.wasm initialized");
			}
		})();
		return ffmpegInitPromise;
	}
    
    function exportMP3(){
        if (downloadState != -1)
            return;

        downloadState = 0;
        downloadElem.classList.add("active");
        downloadElem.innerHTML = "<b>Starting MP3</b><br>";
        createAndDownloadMp3(getUrls()).then((p)=>{});
    }



    // Helper function for fallback blob download (older browsers)
    async function fallbackBlobDownload(files, filename) {
        downloadElem.innerHTML += "Using fallback download method...<br>";
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        const zipBlob = await downloadZip(files).blob();

        downloadElem.innerHTML += "Generated zip file! <br>";
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        const downloadUrl = URL.createObjectURL(zipBlob);

        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(downloadUrl), 100);
    }

    async function createAndDownloadZip(urls, addMeta) {
        const files = [];

        // Fetch all files and add them to the files array
        const fetchPromises = urls.map(async (url) => {
            const response = await fetch(url.url);
            const blob = await response.blob();
            const filename = "Part " + paddy(url.index + 1, 3) + ".mp3";

            let partElem = document.createElement("div");
            partElem.textContent = "Download of "+ filename + " complete";
            downloadElem.appendChild(partElem);
            downloadElem.scrollTo(0, downloadElem.scrollHeight);

            downloadState += 1;

            return {
                name: filename,
                input: blob
            };
        });

        // Start metadata creation in parallel with file downloads
        const metadataPromise = addMeta ? createMetadata() : Promise.resolve([]);

        // Wait for both file downloads and metadata creation to complete
        const [downloadedFiles, metadataFiles] = await Promise.all([
            Promise.all(fetchPromises),
            metadataPromise
        ]);

        files.push(...downloadedFiles);
        files.push(...metadataFiles);

        downloadElem.innerHTML += "<br><b>Downloads complete!</b> Starting ZIP generation and download...<br>";
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        const filename = getAuthorString() + ' - ' + BIF.map.title.main + '.zip';

        // Try using File System Access API for streaming (much faster)
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await unsafeWindow.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'ZIP Archive',
                        accept: {'application/zip': ['.zip']},
                    }],
                });

                downloadElem.innerHTML += "Streaming ZIP file to disk...<br>";
                downloadElem.scrollTo(0, downloadElem.scrollHeight);

                const writable = await handle.createWritable();
                const zipStream = downloadZip(files).body;

                await zipStream.pipeTo(writable);

                downloadElem.innerHTML += "Download complete!<br>";
                downloadElem.scrollTo(0, downloadElem.scrollHeight);
            } catch (err) {
                if (err.name === 'AbortError') {
                    // User cancelled the save dialog
                    downloadElem.innerHTML += "Download cancelled by user.<br>";
                } else {
                    console.error('Streaming download failed:', err);
                    downloadElem.innerHTML += "Streaming failed, using fallback...<br>";
                    // Fall back to blob method
                    await fallbackBlobDownload(files, filename);
                }
            }
        } else {
            // Fall back to blob method for older browsers
            await fallbackBlobDownload(files, filename);
        }

        downloadState = -1;
        downloadElem.innerHTML = ""
        downloadElem.classList.remove("active");
    }

    function exportChapters(){
        if (downloadState != -1)
            return;

        downloadState = 0;
        downloadElem.classList.add("active");
        downloadElem.innerHTML = "<b>Starting export</b><br>";
        createAndDownloadZip(getUrls(), true).then((p)=>{});
    }

    // Main entry point for audiobooks
    function bifFoundAudiobook(){
        // New global style info
        let s = document.createElement("style");
        s.innerHTML = CSS;
        document.head.appendChild(s)
        if (odreadCmptParams == null){
            alert("odreadCmptParams not set, so cannot resolve book urls! Please try refreshing.")
            return;
        }

        buildPirateUi();
		initFFmpeg().catch(console.error);
    }



    /* =========================================
              END AUDIOBOOK SECTION!
       =========================================
    */

    /* =========================================
              BEGIN BOOK SECTION!
       =========================================
    */
    const bookNav = `
        <div style="text-align: center; width: 100%;">
           <a class="pLink" id="download"> <h1> Download EPUB </h1> </a>
        </div>
    `;
    unsafeWindow.pages = {};

    // Libby used the bind method as a way to "safely" expose
    // the decryption module. THIS IS THEIR DOWNFALL.
    // As we can hook bind, allowing us to obtain the
    // decryption function
    const originalBind = Function.prototype.bind;
    Function.prototype.bind = function(...args) {
        const boundFn = originalBind.apply(this, args);
        
        // Store bound arguments (excluding `this`) for potential decryption function
        boundFn.__boundArgs = args.slice(1);
        
        // Also store the original function for debugging
        boundFn.__originalFunction = this;
        
        // If this looks like a decryption function, store it globally
        if (this.toString().includes('decryption') || 
            args.some(arg => typeof arg === 'function' && arg.toString().includes('decryption'))) {
            console.log("Decryption function detected:", this);
            unsafeWindow.__libregrab_decryption_fn = args.find(arg => typeof arg === 'function');
        }
        
        return boundFn;
    };


    async function waitForChapters(callback){
        let components = getBookComponents();
        // Force all the chapters to load in.
        components.forEach(page =>{
            if (undefined != unsafeWindow.pages[page.id]) return;
            page._loadContent({callback: ()=>{}})
        });
        // But its not instant, so we need to wait until they are all set (see: bifFound())
        while (components.filter((page)=>undefined==unsafeWindow.pages[page.id]).length){
            await new Promise(r => setTimeout(r, 100));
            callback();
            console.log(components.filter((page)=>undefined==unsafeWindow.pages[page.id]).length);
        }
    }
    function getBookComponents(){
        return BIF.objects.reader._.context.spine._.components.filter(p => "hidden" != (p.block || {}).behavior)
    }
    function truncate(path){
        return path.substring(path.lastIndexOf('/') + 1);
    }
    function goOneLevelUp(url) {
        let u = new URL(url);
        if (u.pathname === "/") return url; // Already at root

        u.pathname = u.pathname.replace(/\/[^/]*\/?$/, "/");
        return u.toString();
    }
    function getFilenameFromURL(url) {
        const parsedUrl = new URL(url);
        const pathname = parsedUrl.pathname;
        return pathname.substring(pathname.lastIndexOf('/') + 1);
    }
    async function createContent(files, imgAssests){

        let cssRegistry = {};

        let components = getBookComponents();
        let totComp = components.length;
        downloadElem.innerHTML += `Gathering chapters <span id="chapAcc"> 0/${totComp} </span><br>`
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        let gc = 0;
        await waitForChapters(()=>{
            gc+=1;
            downloadElem.querySelector("span#chapAcc").innerHTML = ` ${components.filter((page)=>undefined!=unsafeWindow.pages[page.id]).length}/${totComp}`;
        });

        downloadElem.innerHTML += `Chapter gathering complete<br>`
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        let idToIfram = {};
        let idToMetaId = {};
        components.forEach(c=>{
            // Nothing that can be done here...
            if (c.sheetBox.querySelector("iframe") == null){
                console.warn("!!!" + unsafeWindow.pages[c.id]);
                return;
            }
            c.meta.id = c.meta.id || crypto.randomUUID()
            idToMetaId[c.id] = c.meta.id;
            idToIfram[c.id] = c.sheetBox.querySelector("iframe");

            c.sheetBox.querySelector("iframe").contentWindow.document.querySelectorAll("link").forEach(link=>{
                cssRegistry[c.id] = cssRegistry[c.id] || [];
                cssRegistry[c.id].push(link.href);

                if (imgAssests.includes(link.href)) return;
                imgAssests.push(link.href);


            });
        });
        let url = location.origin;
        for (let i of Object.keys(unsafeWindow.pages)){
            if (idToIfram[i])
                url = idToIfram[i].src;
            files.push({
                name: "OEBPS/" + truncate(i),
                input: fixXhtml(idToMetaId[i], url, unsafeWindow.pages[i], imgAssests, cssRegistry[i] || [])
            });
        }

        downloadElem.innerHTML += `Downloading assets <span id="assetGath"> 0/${imgAssests.length} </span><br>`
        downloadElem.scrollTo(0, downloadElem.scrollHeight);


        gc = 0;
        await Promise.all(imgAssests.map(name=>(async function(){
            const response = await fetch(name.startsWith("http") ? name : location.origin + "/" + name);
            if (response.status != 200) {
                downloadElem.innerHTML += `<b>WARNING:</b> Could not fetch ${name}<br>`
                downloadElem.scrollTo(0, downloadElem.scrollHeight);
                return;
            }
            const blob = await response.blob();

            files.push({
                name: "OEBPS/" + (name.startsWith("http") ? getFilenameFromURL(name) : name),
                input: blob
            });

            gc+=1;
            downloadElem.querySelector("span#assetGath").innerHTML = ` ${gc}/${imgAssests.length} `;
        })()));
    }
    function enforceEpubXHTML(metaId, url, htmlString, assetRegistry, links) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');
        const bod = doc.querySelector("body");
        if (bod){
            bod.setAttribute("id", metaId);
        }

        // Convert all elements to lowercase tag names
        const elements = doc.getElementsByTagName('*');
        for (let el of elements) {
            const newElement = doc.createElement(el.tagName.toLowerCase());

            // Copy attributes to the new element
            for (let attr of el.attributes) {
                newElement.setAttribute(attr.name, attr.value);
            }

            // Move child nodes to the new element
            while (el.firstChild) {
                newElement.appendChild(el.firstChild);
            }

            // Replace old element with the new one
            el.parentNode.replaceChild(newElement, el);
        }

        for (let el of elements) {
            if (el.tagName.toLowerCase() == "img" || el.tagName.toLowerCase() == "image"){
                let src = el.getAttribute("src") || el.getAttribute("xlink:href");
                if (!src) continue;

                if (!(src.startsWith("http://") ||  src.startsWith("https://"))){
                    src = (new URL(src, new URL(url))).toString();
                }
                if (!assetRegistry.includes(src))
                    assetRegistry.push(src);

                if (el.getAttribute("src"))
                    el.setAttribute("src", truncate(src));
                if (el.getAttribute("xlink:href"))
                    el.setAttribute("xlink:href", truncate(src));
            }
        }


        // Ensure the <head> element exists with a <title>
        let head = doc.querySelector('head');
        if (!head) {
            head = doc.createElement('head');
            doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
        }

        let title = head.querySelector('title');
        if (!title) {
            title = doc.createElement('title');
            title.textContent = BIF.map.title.main; // Default title
            head.appendChild(title);
        }

        for (let link of links){
            let src = link;
            if (!(src.startsWith("http://") || src.startsWith("https://"))) {
              src = (new URL(src, new URL(url))).toString();
            }
            let linkElement = doc.createElement('link');
            linkElement.setAttribute("href", truncate(src));
            linkElement.setAttribute("rel", "stylesheet");
            linkElement.setAttribute("type", "text/css");
            head.appendChild(linkElement);
        }

        // Get the serialized XHTML string
        const serializer = new XMLSerializer();
        let xhtmlString = serializer.serializeToString(doc);

        // Ensure proper namespaces (if not already present)
        if (!xhtmlString.includes('xmlns="http://www.w3.org/1999/xhtml"')) {
            xhtmlString = xhtmlString.replace('<html>', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:m="http://www.w3.org/1998/Math/MathML" xmlns:pls="http://www.w3.org/2005/01/pronunciation-lexicon" xmlns:ssml="http://www.w3.org/2001/10/synthesis" xmlns:svg="http://www.w3.org/2000/svg">');
        }

        return xhtmlString;
    }
    function fixXhtml(metaId, url, html, assetRegistry, links){
        html = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
` + enforceEpubXHTML(metaId, url, `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:m="http://www.w3.org/1998/Math/MathML" xmlns:pls="http://www.w3.org/2005/01/pronunciation-lexicon" xmlns:ssml="http://www.w3.org/2001/10/synthesis" xmlns:svg="http://www.w3.org/2000/svg">`
            + html + `</html>`, assetRegistry, links);



        return html;
    }
    function getMimeTypeFromFileName(fileName) {
        const mimeTypes = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            bmp: 'image/bmp',
            webp: 'image/webp',
            mp4: 'video/mp4',
            mp3: 'audio/mp3',
            pdf: 'application/pdf',
            txt: 'text/plain',
            html: 'text/html',
            css: 'text/css',
            json: 'application/json',
            // Add more extensions as needed
        };

        const ext = fileName.split('.').pop().toLowerCase();
        return mimeTypes[ext] || 'application/octet-stream';
    }
    function makePackage(files, assetRegistry){
        const idStore = [];
        const doc = document.implementation.createDocument(
            'http://www.idpf.org/2007/opf', // default namespace
            'package', // root element name
            null // do not specify a doctype
        );

        // Step 2: Set attributes for the root element
        const packageElement = doc.documentElement;
        packageElement.setAttribute('version', '2.0');
        packageElement.setAttribute('xml:lang', 'en');
        packageElement.setAttribute('unique-identifier', 'pub-identifier');
        packageElement.setAttribute('xmlns', 'http://www.idpf.org/2007/opf');
        packageElement.setAttribute('xmlns:dc', 'http://purl.org/dc/elements/1.1/');
        packageElement.setAttribute('xmlns:dcterms', 'http://purl.org/dc/terms/');
        packageElement.setAttribute('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');

        // Step 3: Create and append child elements to the root
        const metadata = doc.createElementNS('http://www.idpf.org/2007/opf', 'metadata');
        packageElement.appendChild(metadata);

        // Create child elements for metadata
        const dcIdentifier = doc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:identifier');
        dcIdentifier.setAttribute('id', 'pub-identifier');
        dcIdentifier.textContent = "" + BIF.map["-odread-buid"];
        metadata.appendChild(dcIdentifier);

        // Language
        if (BIF.map.language.length){
            const dcLanguage = doc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:language');
            dcLanguage.setAttribute('xsi:type', 'dcterms:RFC4646');
            dcLanguage.textContent = BIF.map.language[0];
            packageElement.setAttribute('xml:lang', BIF.map.language[0]);
            metadata.appendChild(dcLanguage);
        }

        // Identifier
        const metaIdentifier = doc.createElementNS('http://www.idpf.org/2007/opf', 'meta');
        metaIdentifier.setAttribute('id', 'meta-identifier');
        metaIdentifier.setAttribute('property', 'dcterms:identifier');
        metaIdentifier.textContent = "" + BIF.map["-odread-buid"];
        metadata.appendChild(metaIdentifier);

        // Title
        const dcTitle = doc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:title');
        dcTitle.setAttribute('id', 'pub-title');
        dcTitle.textContent = BIF.map.title.main;
        metadata.appendChild(dcTitle);


        // Creator (Author)
        if(BIF.map.creator.length){
            const dcCreator = doc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:creator');
            dcCreator.textContent = BIF.map.creator[0].name;
            metadata.appendChild(dcCreator);
        }

        // Description
        if(BIF.map.description){
            // Remove HTML tags
            let p = document.createElement("p");
            p.innerHTML = BIF.map.description.full;


            const dcDescription = doc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:description');
            dcDescription.textContent = p.textContent;
            metadata.appendChild(dcDescription);
        }

        // Step 4: Create the manifest, spine, guide, and other sections...
        const manifest = doc.createElementNS('http://www.idpf.org/2007/opf', 'manifest');
        packageElement.appendChild(manifest);

        const spine = doc.createElementNS('http://www.idpf.org/2007/opf', 'spine');
        spine.setAttribute("toc", "ncx");
        packageElement.appendChild(spine);


        const item = doc.createElementNS('http://www.idpf.org/2007/opf', 'item');
        item.setAttribute('id', 'ncx');
        item.setAttribute('href', 'toc.ncx');
        item.setAttribute('media-type', 'application/x-dtbncx+xml');
        manifest.appendChild(item);


        // Generate out the manifest
        let components = getBookComponents();
        components.forEach(chapter =>{
            const item = doc.createElementNS('http://www.idpf.org/2007/opf', 'item');
            let id = chapter.meta.id || crypto.randomUUID();
            while (idStore.includes(id)) {
              id = id + "-" + crypto.randomUUID();
            }
            item.setAttribute('id', id);
            idStore.push(id);
            item.setAttribute('href', truncate(chapter.meta.path));
            item.setAttribute('media-type', 'application/xhtml+xml');
            manifest.appendChild(item);


            const itemref = doc.createElementNS('http://www.idpf.org/2007/opf', 'itemref');
            itemref.setAttribute('idref', id); // Use the same id as the manifest item
            itemref.setAttribute('linear', "yes");
            spine.appendChild(itemref);
        });

        assetRegistry.forEach(asset => {
            const item = doc.createElementNS('http://www.idpf.org/2007/opf', 'item');
            let aname = asset.startsWith("http") ? getFilenameFromURL(asset) : asset;
            let id = aname.split(".")[0];
            while (idStore.includes(id)) {
              id = id + "-" + crypto.randomUUID();
            }
            item.setAttribute('id', id);
            idStore.push(id);
            item.setAttribute('href', aname);
            item.setAttribute('media-type', getMimeTypeFromFileName(aname));
            manifest.appendChild(item);
        });

        // Step 5: Serialize the document to a string
        const serializer = new XMLSerializer();
        const xmlString = serializer.serializeToString(doc);

        files.push({
            name: "OEBPS/content.opf",
            input: `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n` + xmlString
        });
    }
    function makeToc(files){
        // Step 1: Create the document with a default namespace
        const doc = document.implementation.createDocument(
            'http://www.daisy.org/z3986/2005/ncx/', // default namespace
            'ncx', // root element name
            null // do not specify a doctype
        );

        // Step 2: Set attributes for the root element
        const ncxElement = doc.documentElement;
        ncxElement.setAttribute('version', '2005-1');

        // Step 3: Create and append child elements to the root
        const head = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'head');
        ncxElement.appendChild(head);

        const uidMeta = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'meta');
        uidMeta.setAttribute('name', 'dtb:uid');
        uidMeta.setAttribute('content', "" + BIF.map["-odread-buid"]);
        head.appendChild(uidMeta);

        // Step 4: Create docTitle and add text
        const docTitle = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'docTitle');
        ncxElement.appendChild(docTitle);

        const textElement = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'text');
        textElement.textContent = BIF.map.title.main;
        docTitle.appendChild(textElement);

        // Step 5: Create navMap and append navPoint elements
        const navMap = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'navMap');
        ncxElement.appendChild(navMap);


        let components = getBookComponents();

        components.forEach(chapter =>{
            // First navPoint
            const navPoint1 = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'navPoint');
            navPoint1.setAttribute('id', chapter.meta.id);
            navPoint1.setAttribute('playOrder', '' + (1+chapter.index));
            navMap.appendChild(navPoint1);

            const navLabel1 = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'navLabel');
            navPoint1.appendChild(navLabel1);

            const text1 = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'text');
            text1.textContent = BIF.map.title.main;
            navLabel1.appendChild(text1);

            const content1 = doc.createElementNS('http://www.daisy.org/z3986/2005/ncx/', 'content');
            content1.setAttribute('src', truncate(chapter.meta.path));
            navPoint1.appendChild(content1);
        });


        // Step 6: Serialize the document to a string
        const serializer = new XMLSerializer();
        const xmlString = serializer.serializeToString(doc);

        files.push({
            name: "OEBPS/toc.ncx",
            input: `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n` + xmlString
        });
    }
    async function downloadEPUB(){
        let imageAssets = new Array();
        const files = [];

        // Add mimetype file (must be first and uncompressed for EPUB spec)
        files.push({
            name: "mimetype",
            input: "application/epub+zip"
        });

        // Add META-INF files
        files.push({
            name: "META-INF/container.xml",
            input: `<?xml version="1.0" encoding="UTF-8"?>
                <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                    <rootfiles>
                        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
                    </rootfiles>
                </container>
        `
        });
        
        // Add required encryption file for DRM compliance (required by EPUB spec)
        files.push({
            name: "META-INF/encryption.xml",
            input: `<?xml version="1.0" encoding="UTF-8"?>
                <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"/>
        `
        });

        await createContent(files, imageAssets);

        makePackage(files, imageAssets);
        makeToc(files);


        downloadElem.innerHTML += "<br><b>Downloads complete!</b> Starting EPUB generation and download...<br>";
        downloadElem.scrollTo(0, downloadElem.scrollHeight);

        const filename = BIF.map.title.main + '.epub';

        // Try using File System Access API for streaming (much faster)
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await unsafeWindow.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'EPUB eBook',
                        accept: {'application/epub+zip': ['.epub']},
                    }],
                });

                downloadElem.innerHTML += "Streaming EPUB file to disk...<br>";
                downloadElem.scrollTo(0, downloadElem.scrollHeight);

                const writable = await handle.createWritable();
                const zipStream = downloadZip(files).body;

                await zipStream.pipeTo(writable);

                downloadElem.innerHTML += "Download complete!<br>";
                downloadElem.scrollTo(0, downloadElem.scrollHeight);
            } catch (err) {
                if (err.name === 'AbortError') {
                    // User cancelled the save dialog
                    downloadElem.innerHTML += "Download cancelled by user.<br>";
                } else {
                    console.error('Streaming download failed:', err);
                    downloadElem.innerHTML += "Streaming failed, using fallback...<br>";
                    // Fall back to blob method
                    await fallbackBlobDownload(files, filename);
                }
            }
        } else {
            // Fall back to blob method for older browsers
            await fallbackBlobDownload(files, filename);
        }

        downloadState = -1;
    }

// Main entry point for audiobooks
function bifFoundBook(){
    // New global style info
    let s = document.createElement("style");
    s.innerHTML = CSS;
    document.head.appendChild(s)

    if (!unsafeWindow.__bif_cfc1){
        alert("Injection failed! __bif_cfc1 not found");
        return;
    }
    
    // Debug: Log the original function structure
    console.log("Original __bif_cfc1:", unsafeWindow.__bif_cfc1);
    console.log("__bif_cfc1.__boundArgs:", unsafeWindow.__bif_cfc1.__boundArgs);
    const old_crf1 = unsafeWindow.__bif_cfc1;
    unsafeWindow.__bif_cfc1 = (win, edata)=>{
        // If the bind hook succeeds, then the first element of bound args
        // will be the decryption function. So we just passivly build up an
        // index of the pages!
        if (old_crf1.__boundArgs && old_crf1.__boundArgs[0]) {
            pages[win.name] = old_crf1.__boundArgs[0](edata);
        } else {
            console.warn("Bind args not found, trying alternative decryption method");
            // Try global decryption function if available
            if (unsafeWindow.__libregrab_decryption_fn) {
                try {
                    pages[win.name] = unsafeWindow.__libregrab_decryption_fn(edata);
                } catch (error) {
                    console.error("Global decryption function failed:", error);
                }
            }
            // Final fallback: try to extract decrypted content directly
            try {
                pages[win.name] = old_crf1(win, edata);
            } catch (error) {
                console.error("Failed to decrypt content:", error);
                console.log("Attempting raw edata extraction");
                pages[win.name] = edata; // Sometimes the edata is already decrypted
            }
        }
        return old_crf1(win, edata);
    };

    buildBookPirateUi();
}

function downloadEPUBBBtn(){
    if (downloadState != -1)
        return;

    downloadState = 0;
    downloadElem.classList.add("active");
    downloadElem.innerHTML = "<b>Starting download</b><br>";

    downloadEPUB().then(()=>{});
}
function buildBookPirateUi(){
    // Create the nav
    let nav = document.createElement("div");
    nav.innerHTML = bookNav;
    nav.querySelector("#download").onclick = downloadEPUBBBtn;
    nav.classList.add("pNav");
    let pbar = document.querySelector(".nav-progress-bar");
    pbar.insertBefore(nav, pbar.children[1]);



    downloadElem = document.createElement("div");
    downloadElem.classList.add("foldMenu");
    downloadElem.setAttribute("tabindex", "-1"); // Don't mess with tab key
    document.body.appendChild(downloadElem);
}

    /* =========================================
              END BOOK SECTION!
       =========================================
    */

    /* =========================================
              BEGIN INITIALIZER SECTION!
       =========================================
    */


// The "BIF" contains all the info we need to download
// stuff, so we wait until the page is loaded, and the
// BIF is present, to inject the pirate menu.
let intr = setInterval(()=>{
    if (unsafeWindow.BIF != undefined && document.querySelector(".nav-progress-bar") != undefined){
        clearInterval(intr);
        let mode = location.hostname.split(".")[1];
        if (mode == "listen"){
            bifFoundAudiobook();
        }else if (mode == "read"){
            bifFoundBook();
        }
    }
}, 25);
})();
