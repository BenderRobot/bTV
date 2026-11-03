const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
test('all runtime scripts are local, present, and vendors match the reviewed versions', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
    assert(scripts.length > 10);
    for (const script of scripts) {
        assert.match(script, /^js\/[\w/.-]+\.js$/);
        assert(fs.existsSync(path.join(root, script)));
    }
    for (const [file, hash] of Object.entries({
        'hls-1.7.1.min.js': '6cfad701a61fb8a99add5e84449e64661169b0652bf44ceb2a28465c8817b5f1',
        'lucide-1.38.0.min.js': 'd63e7aa2190e138861c68cdc33a7c7f8caee69b50e9a5b3ac016950a63eaad38',
        'qrcode-generator-1.4.4.js': '18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780'
    })) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'js/vendor', file))).digest('hex'), hash);
    for (const name of ['hls.js', 'lucide', 'qrcode-generator']) assert(fs.statSync(path.join(root, 'js/vendor/LICENSE-' + name + '.txt')).size > 1000);
});
test('manifest, build metadata and access configuration report the same version and preserve application identity', () => {
    const version = require('../package.json').version;
    const xml = fs.readFileSync(path.join(root, 'config.xml'), 'utf8');
    assert(xml.includes('version="' + version + '"'));
    assert(xml.includes('id="bfgs9jFN9d.MyIPtv"'));
    assert(fs.readFileSync(path.join(root, 'js/access-config.js'), 'utf8').includes("version: '" + version + "'"));
    assert(!xml.includes('privilege/keymanager'));
});
