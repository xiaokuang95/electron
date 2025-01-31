import { fetchWithSession } from '@electron/internal/browser/api/net-fetch';
import * as deprecate from '@electron/internal/common/deprecate';

import { desktopCapturer, net } from 'electron/main';

const { fromPartition, fromPath, Session } = process._linkedBinding('electron_browser_session');
const { isDisplayMediaSystemPickerAvailable } = process._linkedBinding('electron_browser_desktop_capturer');

async function getNativePickerSource (preferredDisplaySurface: string) {
  // Fake video window that activates the native system picker
  // This is used to get around the need for a screen/window
  // id in Chrome's desktopCapturer.
  let fakeVideoWindowId = -1;
  const kMacOsNativePickerId = -4;

  if (process.platform !== 'darwin') {
    throw new Error('Native system picker option is currently only supported on MacOS');
  }

  if (!isDisplayMediaSystemPickerAvailable) {
    throw new Error(`Native system picker unavailable. 
      Note: This is an experimental API; please check the API documentation for updated restrictions`);
  }

  let types: Electron.SourcesOptions['types'];
  switch (preferredDisplaySurface) {
    case 'no_preference':
      types = ['screen', 'window'];
      break;
    case 'monitor':
      types = ['screen'];
      break;
    case 'window':
      types = ['window'];
      break;
    default:
      types = ['screen', 'window'];
  }

  // Pass in the needed options for a more native experience
  // screen & windows by default, no thumbnails, since the native picker doesn't return them
  const options: Electron.SourcesOptions = {
    types,
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false
  };

  const mediaStreams = await desktopCapturer.getSources(options);

  if (mediaStreams.length === 0) {
    throw new Error('No media streams found');
  }

  mediaStreams[0].id = `none:${kMacOsNativePickerId}:${fakeVideoWindowId--}`;

  return mediaStreams[0];
}

Session.prototype.fetch = function (input: RequestInfo, init?: RequestInit) {
  return fetchWithSession(input, init, this, net.request);
};

Session.prototype.setDisplayMediaRequestHandler = function (handler, opts) {
  if (!handler) return this._setDisplayMediaRequestHandler(handler, opts);

  this._setDisplayMediaRequestHandler(async (request, callback) => {
    if (opts && opts.useSystemPicker && isDisplayMediaSystemPickerAvailable()) {
      return callback({ video: await getNativePickerSource(request.preferredDisplaySurface) });
    }

    return handler(request, callback);
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
