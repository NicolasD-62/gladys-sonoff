const Promise = require('bluebird');
const util = require('util');
const mqtt = require('mqtt');

// HTTP protocol
const regexCheckIp = '^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$';
const powerReq = 'http://%s/cm?cmnd=Power%s%20%s';

// MQTT protocol (%prefix%/%topic%/%command%)
const powerMqttCmd = 'cmnd/%s/power%s';
const powerMqttStat = 'stat/%s/POWER%s';
// const powerMqtt = 'tasmota/%s/cmnd/Power%s';

module.exports = function exec(params) {
  if (params.deviceType.type === 'binary') {
    const identifier = params.deviceType.identifier.split('_');
    const id = identifier.length > 1 ? identifier[1] : '';
    switch (params.deviceType.protocol) {
      case 'http':
        const ip = identifier[0];
        if (ip.match(regexCheckIp)) {
          return setHttpState(ip, id, params.state.value);
        } else {
          sails.log.error(`Sonoff - Device identifier invalid or unknown: ${ip}`);
          return Promise.reject();
        }

      case 'mqtt':
        const topic = identifier[0];
        return setMqttState(topic, id, params.state.value);

      default:
        return Promise.reject();
    }
  }

  sails.log.error(`Sonoff - DeviceType type invalid or unknown: ${params.deviceType.type}`);
  return Promise.reject();
};

function setHttpState(ip, id, value) {
  const req = util.format(powerReq, ip, id, value === 1 ? 'on' : 'off');
  sails.log.info(`Sonoff - Sending ${req}`);

  return gladys.utils.request(req)
    .then((response) => {
      const newState = response[`POWER${id}`];
      sails.log.info(`Sonoff - New state: ${newState}`);

      if (newState == 'OFF') {
        return Promise.resolve(0);
      } else if (newState == 'ON') {
        return Promise.resolve(1);
      } else {
        sails.log.error(`Sonoff - HTTP response: ${response}`);
        return Promise.reject();
      }
    })
    .catch((error) => {
      sails.log.error(`Sonoff - Error: ${error}`);
      return Promise.reject(error);
    });
}

function setMqttState(topic, id, value) {
  return gladys.param.getValues(['MQTT_URL', 'MQTT_USERNAME', 'MQTT_PASSWORD'])
    .spread(function (url, username, password) {
      const client = mqtt.connect(url, {
        username: username,
        password: password
      });

      client.on('connect', () => {
        sails.log.info(`Sonoff - Successfully connected to MQTT : ${url}`);

        const req = util.format(powerMqttCmd, topic, id);
        const state = value === 1 ? 'on' : 'off';
        sails.log.info(`Sonoff - Sending ${req} ${state}`);
        client.publish(req, state);
      });

      client.on('message', (topic, message) => {
        const req = util.format(powerMqttStat, topic, id);
        if (topic.indewOf(req) > 1) {
          const newState = message === 'ON' ? 1 : 0;
          sails.log.info(`Sonoff - New state: ${newState}`);
          client.end();
          return Promise.resolve(newState);
        }
      });

      client.on('error', (error) => {
        sails.log.error(`Sonoff - Error: ${error}`);
        client.end();
        return Promise.reject(error);
      });
    });
}
