/* jshint -W097 */
/* jshint -W030 */
/* jshint strict:true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

const utils = require('@iobroker/adapter-core');
const dwd = require(__dirname + '/lib/dwd');
const request = require('request-promise-native');
const adapterName = require('./package.json').name.split('.').pop();
const adapterNodeVer = require('./package.json').engines.node;
const semver = require('semver');

let adapter;

function startAdapter(options) {
  options = options || {};
  options.name = adapterName;
  adapter = new utils.Adapter(options);

  // *****************************************************************************************************
  // is called when adapter shuts down - callback has to be called under any circumstances!
  // *****************************************************************************************************
  adapter.on('unload', async (callback) => {
    try {
      adapter.log.info('Closing Adapter');
      callback();
    } catch (e) {
      // adapter.log.error('Error');
      callback();
    }
  });

  // *****************************************************************************************************
  // Listen for sendTo messages
  // *****************************************************************************************************
  adapter.on('message', async (msg) => {

  });

  // *****************************************************************************************************
  // is called when databases are connected and adapter received configuration.
  // start here!
  // *****************************************************************************************************
  adapter.on('ready', async () => {
    adapter.log.info('Starting Adapter ' + adapter.namespace + ' in version ' + adapter.version);
    if (!semver.satisfies(process.version, adapterNodeVer)) {
      adapter.log.error(`Required node version ${adapterNodeVer} not satisfied with current version ${process.version}.`);
      setTimeout(() => adapter.stop());
    }
    await main();
  });
  return adapter;
}

function datePlusdDays(date, number) {
  let mydate = new Date(date.getTime());
  mydate.setDate(mydate.getDate() + number);
  return mydate;
}

function getRiskIndexText(index) {
  let indextext = {
    '0': 'keine Belastung',
    '0-1': 'keine bis geringe Belastung',
    '1': 'geringe Belastung',
    '1-2': 'geringe bis mittlere Belastung',
    '2': 'mittlere Belastung',
    '2-3': 'mittlere bis hohe Belastung',
    '3': 'hohe Belastung'
  };
  return indextext[index] || 'unbekannt';
}

function getRiskNumber(index) {
  let number;
  switch (index) {
    case '0-1':
      number = 0.5;
      break;
    case '1-2':
      number = 1.5;
      break;
    case '2-3':
      number = 2.5;
      break;
    default:
      number = 1.0 * index;
      break;
  }
  return number;
}

// *****************************************************************************************************
// 21.02.2019 11:00 Uhr -> Date Object
// *****************************************************************************************************
function getDate(datum) {
  let mydate;
  if (datum) {
    // let seps = [' ', '\\\.', '\\\+', '-', '\\\(', '\\\)', '\\*', '/', ':', '\\\?'];
    let seps = [' ', '\\.', '\\+', '-', '\\(', '\\)', '\\*', '/', ':', '\\?'];
    let fields = datum.split(new RegExp(seps.join('|'), 'g'));
    mydate = new Date(fields[0], fields[1] - 1, fields[2], fields[3], fields[4]);
  }
  return mydate;
}

function getWeekday(datum) {
  let weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednsday', 'Thursday', 'Friday', 'Saturday'];
  let n = weekday[datum.getDay()];
  return n;
}

async function deleteObjects(result) {
  try {
    if (result) {
      let content = getPollenflugForRegion(result, adapter.config.region) || [];
      let devices = await adapter.getDevicesAsync();
      for (let j in devices) {
        let id = devices[j]._id.replace(adapter.namespace + '.', '');
        let found = false;
        for (let i in content) {
          let entry = content[i];
          let partregion_id = entry.partregion_id != -1 ? entry.partregion_id : entry.region_id;
          let deviceid = 'region#' + partregion_id;
          if (deviceid === id || id === 'info') {
            found = true;
            break;
          }
        }
        if (found === false) {
          await adapter.deleteDeviceAsync(id);
        }
      }
    }
  } catch (error) {
    adapter.log.error('Error deleting Objects');
  }
}

async function createObjects(result) {
  try {
    if (result) {
      let content = getPollenflugForRegion(result, adapter.config.region) || [];
      let promise = [];
      for (let i in content) {
        let entry = content[i];
        let partregion_id = entry.partregion_id != -1 ? entry.partregion_id : entry.region_id;
        let partregion_name = entry.partregion_id != -1 ? entry.region_name + ' - ' + entry.partregion_name : entry.region_name;
        let deviceid = adapter.namespace + '.region#' + partregion_id;
        await adapter.setObjectNotExistsAsync(deviceid, {
          type: 'device',
          common: {
            name: partregion_name
          }
        });
        for (let j in entry.Pollen) {
          let pollen = entry.Pollen[j];
          let channelid = deviceid + '.' + j;
          await adapter.setObjectNotExistsAsync(channelid, {
            type: 'channel',
            common: {
              name: j
            }
          });
          for (let k in pollen) {
            let riskindex = pollen[k];
            let stateid = channelid + '.index_' + k;
            promise.push(await adapter.setObjectNotExistsAsync(stateid, {
              type: 'state',
              common: {
                name: k,
                type: 'number'
              },
              native: {}
            }));
            stateid = channelid + '.text_' + k;
            promise.push(await adapter.setObjectNotExistsAsync(stateid, {
              type: 'state',
              common: {
                name: k,
                type: 'number'
              },
              native: {}
            }));

            // await adapter.setStateAsync(stateid, {val: riskindex, ack: true} );
          }
        }
      }
      await Promise.all(promise);
      await adapter.setObjectNotExistsAsync('info', {
        type: 'device',
        common: {
          name: 'Informationen'
        }
      });
      await adapter.setObjectNotExistsAsync('info.today', {
        type: 'state',
        common: {
          name: 'Today',
          type: 'string'
        },
        native: {}
      });
      await adapter.setObjectNotExistsAsync('info.tomorrow', {
        type: 'state',
        common: {
          name: 'Tomorow',
          type: 'string'
        },
        native: {}
      });
      await adapter.setObjectNotExistsAsync('info.dayaftertoday', {
        type: 'state',
        common: {
          name: 'Day after today',
          type: 'string'
        },
        native: {}
      });
    }
  } catch (error) {
    adapter.log.error('Error creating Objects');
  }
}


async function setStates(result) {
  try {
    if (result) {
      let content = getPollenflugForRegion(result, adapter.config.region) || [];
      let promise = [];
      for (let i in content) {
        let entry = content[i];
        let partregion_id = entry.partregion_id != -1 ? entry.partregion_id : entry.region_id;
        let deviceid = adapter.namespace + '.region#' + partregion_id;
        for (let j in entry.Pollen) {
          let channelid = deviceid + '.' + j;
          let pollen = entry.Pollen[j];
          for (let k in pollen) {
            let riskindex = pollen[k];
            let stateid = channelid + '.index_' + k;
            promise.push(await adapter.setStateAsync(stateid, { val: getRiskNumber(riskindex), ack: true }));
            stateid = channelid + '.text_' + k;
            promise.push(await adapter.setStateAsync(stateid, { val: getRiskIndexText(riskindex), ack: true }));
          }
        }
      }
      let today = getDate(result.last_update);
      let tomorrow = datePlusdDays(today, 1);
      let dayaftertoday = datePlusdDays(today, 2);
      promise.push(await adapter.setStateAsync('info.today', { val: today, ack: true }));
      promise.push(await adapter.setStateAsync('info.tomorrow', { val: tomorrow, ack: true }));
      promise.push(await adapter.setStateAsync('info.dayaftertoday', { val: dayaftertoday, ack: true }));
      await Promise.all(promise);
    }
  } catch (error) {
    adapter.log.error('Error setting States');
  }
}


function getPollenflugForRegion(data, region) {
  let dataregion = [];
  if (data && data.content) {
    let content = data.content;
    for (let i in content) {
      if (!region || region == '*' || content[i].region_id == region) {
        dataregion.push(content[i]);
      }
    }
  }
  return dataregion;
}

async function pollenflugRequest() {
  let result;
  let url = 'https://opendata.dwd.de/climate_environment/health/alerts/s31fg.json';
  try {
    result = await request(url, { method: 'GET', json: true, timeout: 5000 });
  } catch (error) {
    adapter.log.error('Error requesting URL ' + url);
  }
  return result;
}

async function polling(result) {
  if (!result) {
    result = await pollenflugRequest();
  }
  let polltime = 60 * 1000;
  if (result) {
    await setStates(result);
    let now = new Date();
    let next_update = getDate(result.next_update);
    polltime = (next_update.getTime() - now.getTime()) + 60;
    if (polltime < 0 || polltime >= 2147483647) {
      polltime = 60 * 1000;
    }
  }
  setTimeout(async () => {
    adapter.log.info('Requesting DWD data');
    await polling(result);
  }, polltime);
}

// *****************************************************************************************************
// Main
// *****************************************************************************************************
async function main() {
  let result = await pollenflugRequest();
  if (result) {
    await deleteObjects(result);
    await createObjects(result);
    await polling(result);
  } else {
    adapter.log.error('Error reading pollen risk index');
    setTimeout(async () => {
      await main();
    }, 10 * 1000);
  }
}

// If started as allInOne mode => return function to create instance
if (typeof module !== 'undefined' && module.parent) {
  module.exports = startAdapter;
} else {
  // or start the instance dirbectly
  startAdapter();
}
