import { getContext } from "../../extensions.js";

// --- ตัวแปร ---
let ws;
let isConnected = false;
let myName = "";
let isLeader = false; // ถ้าติ๊กถูก = เราคือคนรวมข้อความและส่งให้ AI
let turnBuffer = {}; // ที่เก็บข้อความ (เฉพาะ Leader ใช้)
let expectedPlayers = 2; // จำนวนคนที่รอ (แก้เลขนี้ในหน้า UI ได้)
let bypassInterceptor = false; // ตัวกัน Loop

// --- UI สร้างปุ่มเชื่อมต่อ ---
jQuery(document).ready(function () {
    const ui = `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Multiplayer Co-op</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="display: block;">
            <div style="display:flex; flex-direction:column; gap:5px;">
                <label>Server IP:</label>
                <input type="text" id="mp-ip" value="localhost:3000" class="text_pole" />
                
                <label style="display:flex; align-items:center; gap:5px;">
                    <input type="checkbox" id="mp-is-leader"> 
                    <span>ฉันคือ Leader (คนคุมบอท)</span>
                </label>

                <div id="leader-options" style="display:none; padding-left:10px; border-left:2px solid gray;">
                    <label>รอผู้เล่น (คน):</label>
                    <input type="number" id="mp-count" value="2" class="text_pole" style="width:50px;" />
                </div>

                <button id="mp-connect" class="menu_button">🔗 Connect</button>
                <div id="mp-status" style="font-size: 0.8em; color: gray;">Status: Offline</div>
            </div>
        </div>
    </div>
    `;
    $('#extensions_settings').append(ui);

    // Toggle Leader Options
    $('#mp-is-leader').change(function() {
        if(this.checked) $('#leader-options').show();
        else $('#leader-options').hide();
    });

    // Connect Button
    $('#mp-connect').click(function() {
        const ip = $('#mp-ip').val();
        isLeader = $('#mp-is-leader').is(':checked');
        expectedPlayers = parseInt($('#mp-count').val());
        connectToServer(ip);
    });
});

// --- Network Logic ---
function connectToServer(ip) {
    ws = new WebSocket('ws://' + ip);

    ws.onopen = () => {
        isConnected = true;
        const context = getContext();
        myName = context.name2 || "Player";
        
        $('#mp-connect').text("✅ Connected");
        $('#mp-status').text(`Online as: ${myName} (${isLeader ? 'LEADER' : 'MEMBER'})`);
        toastr.success("เชื่อมต่อ Server สำเร็จ!");
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };

    ws.onclose = () => {
        isConnected = false;
        $('#mp-connect').text("🔗 Connect");
        $('#mp-status').text("Offline");
        toastr.error("หลุดจาก Server");
    };
}

// --- ส่งข้อมูลออกไป ---
function sendPacket(data) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

// --- รับข้อมูลเข้า ---
function handleMessage(data) {
    // 1. ถ้ามีคนส่งข้อความเข้ามา (Input)
    if (data.type === 'chat_input') {
        if (data.sender !== myName) {
            toastr.info(`${data.sender}: ${data.text}`, "เพื่อนพิมพ์มา");
        }

        // เฉพาะ Leader ที่ต้องเก็บข้อมูลนี้
        if (isLeader) {
            turnBuffer[data.sender] = data.text;
            checkTurn();
        }
    }

    // 2. ถ้า Leader สั่งให้แสดงผลข้อความจาก AI (Output)
    if (data.type === 'ai_response') {
        // แปะข้อความลงในแชทเรา (หลอกว่า AI ตอบ)
        // หมายเหตุ: การแทรกข้อความลงแชทฝั่ง Client โดยตรงซับซ้อนกว่าที่คิด
        // เบื้องต้นให้แสดงผลผ่าน Toast หรือ Log ก่อน เพื่อยืนยันว่าได้รับ
        if (!isLeader) { 
            // TODO: Code ส่วนแทรกข้อความลงแชทจริงๆ จะอยู่ที่นี่
            console.log("AI ตอบมาว่า:", data.text); 
            // การแทรกข้อความต้องใช้ท่าเฉพาะของ ST เดี๋ยวผมสอนเพิ่มถ้าเชื่อมต่อได้แล้ว
        }
    }
}

// --- Logic ของ Leader (รวมร่าง) ---
async function checkTurn() {
    const current = Object.keys(turnBuffer).length;
    $('#mp-status').text(`Waiting: ${current} / ${expectedPlayers}`);

    if (current >= expectedPlayers) {
        toastr.success("ครบทุกคนแล้ว! กำลังส่งให้บอท...", "All Ready");
        
        // รวมข้อความ
        let finalPrompt = "";
        for (const [user, text] of Object.entries(turnBuffer)) {
            finalPrompt += `${user}: ${text}\n`;
        }

        // ยัดลงกล่องข้อความ
        const textarea = document.querySelector('#send_textarea');
        if (textarea) {
            textarea.value = finalPrompt;
            
            // สั่งกดส่งจริงๆ (Bypass Interceptor)
            bypassInterceptor = true;
            document.querySelector('#send_but').click(); 
            
            // เคลียร์ค่า
            turnBuffer = {};
            setTimeout(() => { bypassInterceptor = false; }, 1000);
        }
    }
}

// --- ตัวดักจับ (Interceptor) ---
window.mpInterceptor = async function (chat, contextSize, abort, type) {
    // ถ้าไม่ได้ต่อเน็ต หรือเป็นจังหวะที่ Leader สั่งส่งเอง -> ปล่อยผ่าน
    if (!isConnected || bypassInterceptor) {
        return; 
    }

    const context = getContext();
    const lastMsg = chat[chat.length - 1]; // ข้อความล่าสุด

    // สร้างแพ็คเกจ
    const packet = {
        type: 'chat_input',
        sender: context.name2 || "Unknown",
        text: lastMsg.mes
    };

    // ส่งไป Server
    sendPacket(packet);

    // ถ้าเราเป็น Leader เก็บของตัวเองด้วย
    if (isLeader) {
        turnBuffer[packet.sender] = packet.text;
        toastr.info("เก็บข้อความคุณแล้ว รอคนอื่น...", "Leader");
        checkTurn();
    } else {
        toastr.info("ส่งข้อความไปหา Leader แล้ว", "Sent");
    }

    // หยุดการทำงานเดิม (ไม่ให้ส่งเข้า AI ทันที)
    abort(true);
};