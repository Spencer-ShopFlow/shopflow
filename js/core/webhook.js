// ============================================
// Webhook calls: retry once, and a failure banner (plan row 2-04)
//
// On the school network the script often runs, but its reply is lost on the way back
// (i137, 29 Sep): the browser gets a web page instead of JSON (the one-time echo link
// was used up), or the script's own "GET not supported; please retry" answer.
//
// webhookFetch() is a drop-in for fetch() on the webhook. It:
//  - retries once after 2 s when the reply is lost, but ONLY for actions that are safe
//    to repeat (they read, or overwrite with the same content). Sends, queueing and
//    anything that creates something are never retried: a lost reply may mean it happened.
//  - turns a lost reply into an ordinary { status: 'error', message } answer, so every
//    caller shows a plain message instead of "Unexpected token '<'".
//  - shows a banner when a sync or email call still has no reply.
// ============================================
const WEBHOOK_RETRY_DELAY_MS = 2000;

const WEBHOOK_RETRY_SAFE = new Set([
    'load_from_drive', 'save_to_drive',            // sync: a read, and a whole-file overwrite
    'check_form_submissions', 'sync_to_hub_sheet', // a read, and a tab rewritten with the same data
    'list_classroom_courses', 'list_classroom_coursework', 'list_classroom_topics', 'list_classroom_students',
    'cancel_absence', 'update_absence_missed'      // repeating changes nothing
]);
const WEBHOOK_SYNC_ACTIONS = new Set(['save_to_drive', 'load_from_drive']);
const WEBHOOK_EMAIL_ACTIONS = {
    send_immediate: 'a no-show email',
    queue_absence: 'queuing a no-show email',
    cancel_absence: 'cancelling a queued no-show email',
    update_absence_missed: 'updating a queued no-show email',
    send_queued_now: 'sending the queued no-show emails',
    send_absence_summary: 'the absence summary emails',
    send_roster_notifications: 'the roster emails',
    send_feedback: 'the feedback emails'
};

function webhookActionOf(options) {
    try { return (JSON.parse(options && options.body) || {}).action || ''; } catch (e) { return ''; }
}

// True when the reply isn't the script's answer: not JSON, or the stray GET's "please retry"
function webhookReplyLost(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { return true; }
    return !!(parsed && parsed.status === 'error' && /please retry/i.test(parsed.message || ''));
}

function webhookLostMessage(action) {
    return WEBHOOK_RETRY_SAFE.has(action)
        ? 'No reply from Google (the network lost it, even after a retry). Try again in a minute.'
        : 'No reply from Google. It may have gone through — check before trying again.';
}

function webhookJsonResponse(obj) {
    return new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function webhookFetch(url, options) {
    const action = webhookActionOf(options);
    const canRetry = WEBHOOK_RETRY_SAFE.has(action);
    for (let attempt = 1; ; attempt++) {
        let response = null, text = null, error = null;
        try {
            response = await fetch(url, options);
            text = await response.text();
        } catch (e) {
            error = e;
        }
        // A timeout (AbortError) is final: waiting that long again wouldn't help
        const aborted = error && error.name === 'AbortError';
        const lost = error ? !aborted : webhookReplyLost(text);

        if (!error && !lost) {
            if (WEBHOOK_SYNC_ACTIONS.has(action)) webhookBanner.clear('sync');
            const status = response.status >= 200 && response.status <= 599 ? response.status : 200;
            return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
        }
        if (lost && canRetry && attempt === 1) {
            console.warn(`Webhook ${action}: reply lost, retrying once`);
            await new Promise(res => setTimeout(res, WEBHOOK_RETRY_DELAY_MS));
            continue;
        }
        webhookBanner.report(action);
        if (aborted) throw error;
        console.warn(`Webhook ${action}: no reply`, error || '');
        return webhookJsonResponse({ status: 'error', message: webhookLostMessage(action), replyLost: true });
    }
}

// One banner under the header: sync problems clear themselves on the next good sync;
// email problems stay until she closes them, because something may have gone out.
const webhookBanner = {
    _messages: {},   // kind ('sync' | 'email') -> text

    report: function(action) {
        if (WEBHOOK_SYNC_ACTIONS.has(action)) {
            this._messages.sync = "Sync didn't finish: Google's reply was lost. Nothing on this device is lost. It will try again, or use Sync Now in Settings.";
        } else if (WEBHOOK_EMAIL_ACTIONS[action]) {
            this._messages.email = `No reply from Google for ${WEBHOOK_EMAIL_ACTIONS[action]}. It may have gone through — check your Sent mail before sending again.`;
        } else {
            return;
        }
        this.render();
    },

    clear: function(kind) {
        if (!this._messages[kind]) return;
        delete this._messages[kind];
        this.render();
    },

    render: function() {
        if (typeof document === 'undefined' || !document.body) return;
        let el = document.getElementById('webhook-banner');
        const kinds = Object.keys(this._messages);
        if (kinds.length === 0) { if (el) el.remove(); return; }
        if (!el) {
            el = document.createElement('div');
            el.id = 'webhook-banner';
            el.className = 'webhook-banner';
            el.setAttribute('role', 'alert');
            document.body.insertBefore(el, document.body.firstChild);
        }
        el.innerHTML = kinds.map(k => `
            <div class="webhook-banner__row" data-kind="${k}">
                <span class="webhook-banner__text">⚠️ ${escapeHtml(this._messages[k])}</span>
                <button type="button" class="webhook-banner__close" aria-label="Close" onclick="webhookBanner.clear('${k}')">✕</button>
            </div>`).join('');
    }
};
