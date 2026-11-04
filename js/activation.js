/* Activation screen and foreground lifecycle. The player keeps its native engines. */
(function () {
    'use strict';
    const gate = document.getElementById('activation-gate');
    const message = document.getElementById('activation-message');
    const image = document.getElementById('activation-qr');
    const field = document.getElementById('activation-code');
    const claimButton = document.getElementById('activation-claim');
    const renewButton = document.getElementById('activation-renew');
    const retryButton = document.getElementById('activation-retry');
    const exitButton = document.getElementById('activation-exit');
    const controls = [field, claimButton, renewButton, retryButton, exitButton];
    const messages = {
        activation_required: 'Activez cette TV depuis bTV sur votre téléphone, ou avec votre code de secours.',
        invalid: 'Activation non valide. Demandez un nouveau code ou scannez le nouveau QR depuis bTV.',
        invalid_code: 'Saisissez les 8 caractères de votre code de secours.',
        revoked: 'L’accès de cette TV a été retiré. Contactez la personne qui gère votre accès bTV.',
        expired: 'Votre accès bTV a expiré. Contactez la personne qui le gère.',
        invite_expired: 'Ce code a expiré. Demandez un nouveau code de secours.',
        code_expired: 'Ce code a expiré ou a déjà servi. Demandez un nouveau code.',
        device_limit: 'Toutes les places de cet accès sont prises. Ajoutez une place ou retirez un ancien appareil.',
        slots_full: 'Toutes les places de cet accès sont prises. Ajoutez une place ou retirez un ancien appareil.',
        busy: 'Une demande est déjà en cours, ou le service reçoit trop de tentatives. Patientez puis réessayez.',
        offline: 'La vérification bTV est momentanément impossible. Vérifiez Internet puis réessayez.',
        network: 'Connexion au service bTV interrompue. Réessayez dans un instant.',
        missing_rpc: 'Le service d’activation est indisponible. Réessayez ou contactez la personne qui gère bTV.',
        storage: 'La TV ne peut pas enregistrer vos données de façon sûre. Réessayez avant de continuer.',
        unsupported_storage: 'Le stockage sécurisé est indisponible sur cette TV. Réessayez ou contactez la personne qui gère bTV.',
        unsupported: 'Une fonction nécessaire à l’activation est indisponible sur cette TV.',
        credentials: 'Le compte mémorisé ne peut pas être transféré vers le stockage sécurisé. Il reste conservé. Contactez la personne qui gère bTV.',
        configuration: 'La configuration bTV est indisponible. Contactez la personne qui gère bTV.',
        expired_pair: 'Ce QR code a expiré. Sélectionnez Nouveau QR code.'
    };
    let client = null, initialized = false, blocked = true, generation = 0, busy = false;
    let onReady = null, pair = null, pollTimer = null, checkTimer = null, pollRequest = null, claimRequest = null;
    let focusIndex = 3;
    let starting = null;
    function say(status) { message.textContent = messages[status] || messages.invalid; }
    function clearQr() { image.hidden = true; image.removeAttribute('src'); }
    function stopTimers() { clearTimeout(pollTimer); clearTimeout(checkTimer); pollTimer = checkTimer = null; }
    function focus(index) {
        focusIndex = index;
        controls.forEach((node, i) => node.classList.toggle('activation-focused', i === focusIndex));
        const node = controls[focusIndex];
        if (node !== field && !node.disabled && !node.hidden) node.focus();
        else if (document.activeElement === field) field.blur();
    }
    function stopPlayback() {
        try {
            if (miniPlayerActive) closeMiniPlayerAndDiscard();
            else if (currentView === 'player') stopAndExitPlayer();
            else releasePlaybackResources();
        } catch (_) {
            document.querySelectorAll('video').forEach(video => { try { video.pause(); } catch (_) { /* Keep the gate closed. */ } });
            try { if (window.webapis && webapis.avplay) webapis.avplay.stop(); } catch (_) { /* Gate remains closed. */ }
        }
    }
    function show(status) {
        const wasBlocked = blocked;
        blocked = true;
        gate.hidden = false;
        document.body.classList.add('access-locked');
        if (!wasBlocked) stopPlayback();
        say(status);
    }
    function setBusy(value) {
        busy = value;
        claimButton.disabled = value || !initialized;
        renewButton.disabled = value || !initialized;
        field.disabled = value || !initialized;
        retryButton.disabled = value;
    }
    async function allowed() {
        if (!client || !client.isAllowed() || document.hidden) return;
        const first = blocked;
        blocked = false;
        gate.hidden = true;
        document.body.classList.remove('access-locked');
        pair = null;
        clearQr();
        clearTimeout(pollTimer);
        field.value = '';
        if (first && onReady) await onReady();
        clearTimeout(checkTimer);
        checkTimer = setTimeout(checkAccess, 60000);
    }
    function nextPoll(epoch) {
        clearTimeout(pollTimer);
        if (blocked && pair && !document.hidden && epoch === generation) pollTimer = setTimeout(() => poll(epoch), 3000);
    }
    async function poll(epoch) {
        if (!pair || epoch !== generation || document.hidden || pollRequest || busy) return;
        pollRequest = client.pollPair(pair);
        try {
            const result = await pollRequest;
            if (epoch !== generation || document.hidden) return;
            if (result.status === 'active') { await checkAccess(); return; }
            if (result.status !== 'pending') { pair = null; clearQr(); say(result.status); return; }
        } catch (error) { if (epoch === generation) say(error.code || 'network'); }
        finally { pollRequest = null; nextPoll(epoch); }
    }
    async function newPair() {
        if (!initialized || busy) return;
        const epoch = ++generation;
        pair = null;
        clearQr();
        clearTimeout(pollTimer);
        setBusy(true);
        try {
            if (pollRequest) await pollRequest;
            if (client.isAllowed()) { await checkAccess(); return; }
            const next = await client.startPair();
            if (epoch !== generation || document.hidden) return;
            const config = window.BTV_ACCESS_CONFIG;
            const code = qrcode(0, 'M');
            code.addData(config.invitation + '#pair=' + next.challenge);
            code.make();
            image.src = code.createDataURL(7, 28);
            image.hidden = false;
            pair = next;
            say('activation_required');
        } catch (error) { if (epoch === generation) say(error.code || 'network'); }
        finally { setBusy(false); if (epoch === generation) { focus(0); nextPoll(epoch); } }
    }
    async function claim() {
        if (!initialized || busy) return;
        setBusy(true);
        clearTimeout(pollTimer);
        const epoch = generation;
        try {
            if (pollRequest) await pollRequest;
            if (client.isAllowed()) { await checkAccess(); return; }
            claimRequest = client.claimCode(field.value);
            const result = await claimRequest;
            if (epoch !== generation || document.hidden) return;
            if (result.status === 'active') await checkAccess();
            else say(result.status);
        } catch (error) { if (epoch === generation) say(error.code || 'network'); }
        finally { claimRequest = null; setBusy(false); nextPoll(epoch); }
    }
    async function checkAccess() {
        if (!client || !initialized || document.hidden) return;
        const epoch = generation;
        clearTimeout(checkTimer);
        try {
            const result = await client.check();
            if (document.hidden || epoch !== generation) return;
            if (result.status === 'active' && client.isAllowed()) await allowed();
            else {
                show(result.status);
                clearQr();
                pair = null;
                if (result.status !== 'offline' && !busy) await newPair();
                focus(result.status === 'offline' ? 3 : 0);
            }
        } catch (error) { if (epoch === generation && !document.hidden) { show(error.code || 'storage'); clearQr(); pair = null; focus(3); } }
    }
    function start(callback) {
        if (callback) onReady = callback;
        if (!starting) starting = startOnce().finally(() => { starting = null; });
        return starting;
    }
    async function startOnce() {
        stopTimers();
        generation++;
        clearQr();
        show('offline');
        message.textContent = 'Vérification de votre accès bTV…';
        setBusy(true);
        try {
            // A one-shot claim may have completed while the app was hidden.
            await Promise.all([pollRequest, claimRequest].filter(Boolean).map(request => request.catch(() => {})));
            if (!client) {
                const config = window.BTV_ACCESS_CONFIG || {};
                let version = config.version;
                try { version = tizen.application.getCurrentApplication().appInfo.version || version; } catch (_) { /* Browser QA or unsupported app metadata. */ }
                client = new BtvAccessCore.Client({
                    base: config.base, publicKey: config.publicKey, version,
                    name: 'Samsung · bTV', keymanager: window.tizen && tizen.keymanager,
                    crypto: window.crypto, fetch: window.fetch && window.fetch.bind(window), storage: window.localStorage
                });
            }
            await client.initialize();
            initialized = true;
            setBusy(false);
            await checkAccess();
        } catch (error) { initialized = false; show(error.code || 'storage'); setBusy(false); focus(3); }
    }
    function quit() {
        stopTimers();
        generation++;
        clearQr();
        try { tizen.application.getCurrentApplication().exit(); } catch (_) { message.textContent = 'Vous pouvez fermer bTV avec la touche Accueil de la télécommande.'; }
    }
    function handleKey(event) {
        if (!blocked && client && client.isAllowed()) return false;
        if (!blocked) { show('offline'); checkAccess(); }
        const key = event.keyCode;
        if ([38, 40, 37, 39].includes(key)) {
            if (document.activeElement === field && (key === 37 || key === 39)) return true;
            event.preventDefault();
            const step = key === 38 || key === 37 ? -1 : 1;
            let index = focusIndex;
            for (let n = 0; n < controls.length; n++) {
                index = (index + step + controls.length) % controls.length;
                if (!controls[index].disabled && !controls[index].hidden) { focus(index); break; }
            }
        } else if (key === 13) {
            event.preventDefault();
            if (event.repeat) return true;
            const node = controls[focusIndex];
            if (!node.disabled) {
                if (node === field) { if (document.activeElement === field) claim(); else field.focus(); }
                else node.click();
            }
        } else if (key === 10009 || (key === 8 && document.activeElement !== field)) {
            event.preventDefault();
            if (document.activeElement === field) { field.blur(); focus(1); } else quit();
        }
        return true;
    }
    claimButton.addEventListener('click', claim);
    renewButton.addEventListener('click', newPair);
    retryButton.addEventListener('click', () => start());
    exitButton.addEventListener('click', quit);
    field.addEventListener('focus', () => { focusIndex = 0; controls.forEach((node, i) => node.classList.toggle('activation-focused', i === 0)); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { stopTimers(); generation++; pair = null; clearQr(); show('offline'); }
        else start();
    });
    window.BtvActivation = {
        start,
        handleKey,
        isBlocked: () => blocked || !client || !client.isAllowed(),
        isAllowed: () => !blocked && !!client && client.isAllowed(),
        requireAccess() {
            if (!blocked && client && client.isAllowed()) return true;
            if (!blocked) { show('offline'); checkAccess(); }
            return false;
        },
        readCredentials: () => client && client.readCredentials(),
        syncPull: (key, since) => {
            if (!client || blocked || !client.isAllowed()) throw new BtvAccessCore.AccessError('invalid');
            return client.syncPull(key, since);
        },
        async mediaAccount(value) {
            try { if (!client || !client.isAllowed()) throw new BtvAccessCore.AccessError('invalid'); return await client.mediaAccount(value); }
            catch (error) { show(error.code || 'storage'); throw error; }
        },
        async saveCredentials(value) {
            try { if (!client || !client.isAllowed()) throw new BtvAccessCore.AccessError('invalid'); await client.saveCredentials(value); }
            catch (error) { show(error.code || 'storage'); throw error; }
        },
        async forgetCredentials() {
            if (!client) throw new BtvAccessCore.AccessError('storage');
            await client.forgetCredentials();
        }
    };
    focus(3);
}());
