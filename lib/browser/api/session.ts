import { fetchWithSession } from '@electron/internal/browser/api/net-fetch';
import * as deprecate from '@electron/internal/common/deprecate';
import { desktopCapturer, net } from 'electron/main';

const { fromPartition, fromPath, Session } = process._linkedBinding('electron_browser_session');
const { isDisplayMediaSystemPickerAvailable } = process._linkedBinding('electron_browser_desktop_capturer');

async function getNativePickerSource () {
  if (process.platform !== 'darwin') {
    throw new Error('Native system picker option is currently only supported on MacOS');
  }

  if (!isDisplayMediaSystemPickerAvailable) {
    throw new Error(`Native system picker unavailable. 
      Note: This is an experimental API; please check the API documentation for updated restrictions`);
  }

  // Pass in the needed options for a more native experience
  // screen & windows by default, no thumbnails, since the native picker doesn't return them
  const options: Electron.SourcesOptions = {
    types: ['screen', 'window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false
  };

  const mediaStreams = await desktopCapturer.getSources(options);
  return mediaStreams[0];
}

Session.prototype.fetch = function (input: RequestInfo, init?: RequestInit) {
  return fetchWithSession(input, init, this, net.request);
};

Session.prototype.setDisplayMediaRequestHandler = function (handler, opts) {
  if (!handler) return this._setDisplayMediaRequestHandler(handler, opts);

  this._setDisplayMediaRequestHandler(async (req, callback) => {
    if (opts && opts.useSystemPicker && isDisplayMediaSystemPickerAvailable()) {
      return callback({ video: await getNativePickerSource() });
    }

    return handler(req, callback);
  }, opts);
};

const getPreloadsDeprecated = deprecate.warnOnce('session.getPreloads', 'session.getPreloadScripts');
Session.prototype.getPreloads = function () {
  getPreloadsDeprecated();
  return this.getPreloadScripts()
    .filter((script) => script.type === 'frame')
    .map((script) => script.filePath);
};

const setPreloadsDeprecated = deprecate.warnOnce('session.setPreloads', 'session.registerPreloadScript');
Session.prototype.setPreloads = function (preloads) {
  setPreloadsDeprecated();
  this.getPreloadScripts()
    .filter((script) => script.type === 'frame')
    .forEach((script) => {
      this.unregisterPreloadScript(script.id);
    });
  preloads.map(filePath => ({
    type: 'frame',
    filePath,
    _deprecated: true
  }) as Electron.PreloadScriptRegistration).forEach(script => {
    this.registerPreloadScript(script);
  });
};

export default {
  fromPartition,
  fromPath,
  get defaultSession () {
    return fromPartition('');
  }
};
