import { isArray, logMessage, logWarn, logError, _each } from '../src/utils.js';
import { registerBidder } from '../src/adapters/bidderFactory.js';
import { BANNER } from '../src/mediaTypes.js';
import { ortbConverter } from '../libraries/ortbConverter/converter.js';
import {pbsExtensions} from '../libraries/pbsExtensions/pbsExtensions.js'
import { config } from '../src/config.js';

const BIDDER_CODE = 'luponmedia';

var sizeMap = {
  1: '468x60',
  2: '728x90',
  5: '120x90',
  7: '125x125',
  8: '120x600',
  9: '160x600',
  10: '300x600',
  13: '200x200',
  14: '250x250',
  15: '300x250',
  16: '336x280',
  17: '240x400',
  19: '300x100',
  31: '980x120',
  32: '250x360',
  33: '180x500',
  35: '980x150',
  37: '468x400',
  38: '930x180',
  39: '750x100',
  40: '750x200',
  41: '750x300',
  42: '2x4',
  43: '320x50',
  44: '300x50',
  48: '300x300',
  53: '1024x768',
  54: '300x1050',
  55: '970x90',
  57: '970x250',
  58: '1000x90',
  59: '320x80',
  60: '320x150',
  61: '1000x1000',
  64: '580x500',
  65: '640x480',
  66: '930x600',
  67: '320x480',
  68: '1800x1000',
  72: '320x320',
  73: '320x160',
  78: '980x240',
  79: '980x300',
  80: '980x400',
  83: '480x300',
  85: '300x120',
  90: '548x150',
  94: '970x310',
  95: '970x100',
  96: '970x210',
  101: '480x320',
  102: '768x1024',
  103: '480x280',
  105: '250x800',
  108: '320x240',
  113: '1000x300',
  117: '320x100',
  125: '800x250',
  126: '200x600',
  144: '980x600',
  145: '980x150',
  152: '1000x250',
  156: '640x320',
  159: '320x250',
  179: '250x600',
  195: '600x300',
  198: '640x360',
  199: '640x200',
  213: '1030x590',
  214: '980x360',
  221: '1x1',
  229: '320x180',
  230: '2000x1400',
  232: '580x400',
  234: '6x6',
  251: '2x2',
  256: '480x820',
  257: '400x600',
  258: '500x200',
  259: '998x200',
  264: '970x1000',
  265: '1920x1080',
  274: '1800x200',
  278: '320x500',
  282: '320x400',
  288: '640x380',
  548: '500x1000',
  550: '980x480',
  552: '300x200',
  558: '640x640'
};

_each(sizeMap, (item, key) => sizeMap[item] = key);

const keyIdRegex = /^uid(?:@[\w-]+)?_.*$/;

const buildServerUrl = (keyId) => {
  const match = String(keyId).match(/@([^_]+)_/);

  let host = 'rtb';

  if (match) {
    host = match[1];
  }

  return `https://${host}.adxpremium.services/openrtb2/auction`
}

function hasRtd() {
  const rtdConfigs = config.getConfig('realTimeData.dataProviders') || [];

  return Boolean(rtdConfigs.find(provider => provider.name === 'dynamicAdBoost'));
};

export const converter = ortbConverter({
  processors: pbsExtensions,
  imp(buildImp, bidRequest, context) {
    const imp = buildImp(bidRequest, context);

    imp.ext = imp.ext || {};

    const hasRtdEnabled = hasRtd();

    if (!hasRtdEnabled) {
      logWarn('Luponmedia: The DynamiAdBoost RTD Module is not enabled. Please activate it to maximize the revenue and performance of the LuponMedia Bid Adapter.')
    }

    imp.ext.luponmedia = imp.ext.luponmedia || {};
    imp.ext.luponmedia.placement_id = bidRequest.adUnitCode;
    imp.ext.luponmedia.keyId = bidRequest.params.keyId;
    imp.ext.luponmedia.siteId = bidRequest.params.siteId;
    imp.ext.luponmedia.rtd = hasRtdEnabled;

    return imp;
  }
});

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: [BANNER],
  isBidRequestValid: function (bid) {
    if (!bid?.params?.keyId) {
      return false;
    }

    if (!keyIdRegex.test(bid.params.keyId)) {
      return false;
    }

    return true;
  },
  buildRequests: function (bidRequests, bidderRequest) {
    const filteredRequests = bidRequests.filter(bidRequest => Boolean(bidRequest?.adUnitCode))

    const data = converter.toORTB({ bidderRequest, bidRequests: filteredRequests })

    const serverUrl = buildServerUrl(bidRequests[0].params.keyId);

    return {
      method: 'POST',
      url: serverUrl,
      data: JSON.stringify(data),
      options: {},
      bidderRequest
    };
  },
  interpretResponse: (response, request) => {
    const bidResponses = [];
    var respCur = 'USD';
    let parsedRequest = JSON.parse(request.data);
    let parsedReferrer = parsedRequest.site && parsedRequest.site.ref ? parsedRequest.site.ref : '';

    try {
      if (response.body && response.body.seatbid && isArray(response.body.seatbid)) {
        // Supporting multiple bid responses for same adSize
        respCur = response.body.cur || respCur;
        response.body.seatbid.forEach(seatbidder => {
          seatbidder.bid &&
                        isArray(seatbidder.bid) &&
                        seatbidder.bid.forEach(bid => {
                          let newBid = {
                            requestId: bid.impid,
                            cpm: (parseFloat(bid.price) || 0).toFixed(2),
                            width: bid.w,
                            height: bid.h,
                            creativeId: bid.crid || bid.id,
                            dealId: bid.dealid,
                            currency: respCur,
                            netRevenue: false,
                            ttl: 300,
                            referrer: parsedReferrer,
                            ad: bid.adm
                          };

                          bidResponses.push(newBid);
                        });
        });
      }
    } catch (error) {
      logError(error);
    }
    return bidResponses;
  },
  getUserSyncs: function (syncOptions, responses, gdprConsent, uspConsent) {
    let allUserSyncs = [];
    if (!hasSynced && (syncOptions.iframeEnabled || syncOptions.pixelEnabled)) {
      responses.forEach(csResp => {
        if (csResp.body && csResp.body.ext && csResp.body.ext.usersyncs) {
          try {
            let response = csResp.body.ext.usersyncs;
            let bidders = response.bidder_status;
            for (let synci in bidders) {
              let thisSync = bidders[synci];
              if (thisSync.no_cookie) {
                let url = thisSync.usersync.url;
                let type = thisSync.usersync.type;

                if (!url) {
                  logError(`No sync url for bidder luponmedia.`);
                } else if ((type === 'image' || type === 'redirect') && syncOptions.pixelEnabled) {
                  logMessage(`Invoking image pixel user sync for luponmedia`);
                  allUserSyncs.push({ type: 'image', url: url });
                } else if (type == 'iframe' && syncOptions.iframeEnabled) {
                  logMessage(`Invoking iframe user sync for luponmedia`);
                  allUserSyncs.push({ type: 'iframe', url: url });
                } else {
                  logError(`User sync type "${type}" not supported for luponmedia`);
                }
              }
            }
          } catch (e) {
            logError(e);
          }
        }
      });
    } else {
      logWarn('Luponmedia: Please enable iframe/pixel based user sync.');
    }

    hasSynced = true;
    return allUserSyncs;
  },
};

export function hasValidSupplyChainParams(schain) {
  let isValid = false;
  const requiredFields = ['asi', 'sid', 'hp'];
  if (!schain.nodes) return isValid;
  isValid = schain.nodes.reduce((status, node) => {
    if (!status) return status;
    return requiredFields.every(field => node[field]);
  }, true);
  if (!isValid) logError('LuponMedia: required schain params missing');
  return isValid;
}

var hasSynced = false;

export function resetUserSync() {
  hasSynced = false;
}

export function masSizeOrdering(sizes) {
  const MAS_SIZE_PRIORITY = [15, 2, 9];

  return sizes.sort((first, second) => {
    // sort by MAS_SIZE_PRIORITY priority order
    const firstPriority = MAS_SIZE_PRIORITY.indexOf(first);
    const secondPriority = MAS_SIZE_PRIORITY.indexOf(second);

    if (firstPriority > -1 || secondPriority > -1) {
      if (firstPriority === -1) {
        return 1;
      }
      if (secondPriority === -1) {
        return -1;
      }
      return firstPriority - secondPriority;
    }

    // and finally ascending order
    return first - second;
  });
}

registerBidder(spec);
