'use strict';

// LiFX Platform Shim for HomeBridge
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//         "platform": "LIFx",             // required
//         "name": "LIFx",                 // required
//         "access_token": "access token", // required
//         "use_lan": "true"               // optional set to "true" (gets and sets over the lan) or "get" (gets only over the lan)
//     }
// ],
//
// When you attempt to add a device, it will ask for a "PIN code".
// The default code for all HomeBridge accessories is 031-45-154.
//

var lifxRemoteObj = require('lifx-api');
var lifx_remote;

var lifxLanObj;
var lifx_lan;
var use_lan;

function LIFxPlatform(log, config){
    // auth info
    this.access_token = config["access_token"];

    lifx_remote = new lifxRemoteObj(this.access_token);

    // use remote or lan api ?
    use_lan = config["use_lan"] || false;

    if (use_lan != false) {
        lifxLanObj = require('lifx');
        lifx_lan = lifxLanObj.init();
    }

    this.log = log;
}

LIFxPlatform.prototype = {
    accessories: function(callback) {
        this.log("Fetching LIFx devices.");

        var that = this;
        var foundAccessories = [];

        lifx_remote.listLights("all", function(body) {
            var bulbs = JSON.parse(body);

            for(var i = 0; i < bulbs.length; i ++) {
                var accessory = new LIFxBulbAccessory(that.log, bulbs[i]);
                foundAccessories.push(accessory);
            }
            callback(foundAccessories)
        });
    }
}

function LIFxBulbAccessory(log, bulb) {
    // device info
    this.name = bulb.label;
    this.model = bulb.product_name;
    this.deviceId = bulb.id;
    this.serial = bulb.uuid;
    this.capabilities = bulb.capabilities;
    this.log = log;

    if (use_lan != false && lifx_lan.bulbs[this.deviceId]) {
        var that = this;
        this.bulb = lifx_lan.bulbs[this.deviceId];

        lifx_lan.on('bulbstate', function(bulb) {
            if (bulb.addr.toString('hex') == that.deviceId) {
                that.bulb = bulb;

                if (that.service) {
                    that.service.getCharacteristic(Characteristic.On).setValue(that.bulb.state.power > 0);
                    that.service.getCharacteristic(Characteristic.Brightness).setValue(Math.round(that.bulb.state.brightness * 100 / 65535));

                    if (that.capabilities.has_color == true) {
                        that.service.getCharacteristic(Characteristic.Hue).setValue(Math.round(that.bulb.state.hue * 360 / 65535));
                        that.service.getCharacteristic(Characteristic.Saturation).setValue(Math.round(that.bulb.state.saturation * 100 / 65535));
                    }
                }
            }
        });
    }
}

LIFxBulbAccessory.prototype = {
    getLan: function(type, callback){
        if (!lifx_lan.bulbs[this.deviceId]) {
            callback(new Error("Device not found"), false);
            return;
        }

        switch(type) {
            case "power":
                callback(null, this.bulb.state.power > 0);
                break;
            case "brightness":
                callback(null, Math.round(this.bulb.state.brightness * 100 / 65535));
                break;
            case "hue":
                callback(null, Math.round(this.bulb.state.hue * 360 / 65535));
                break;
            case "saturation":
                callback(null, Math.round(this.bulb.state.saturation * 100 / 65535));
                break;
        }
    },
    getRemote: function(type, callback){
        var that = this;

        lifx_remote.listLights("id:"+ that.deviceId, function(body) {
            var bulb = JSON.parse(body);

            if (bulb.connected != true) {
                callback(new Error("Device not found"), false);
                return;
            }

            switch(type) {
                case "power":
                    callback(null, bulb.power == "on" ? 1 : 0);
                    break;
                case "brightness":
                    callback(null, Math.round(bulb.brightness * 100));
                    break;
                case "hue":
                    callback(null, bulb.color.hue);
                    break;
                case "saturation":
                    callback(null, Math.round(bulb.color.saturation * 100));
                    break;
            }
        });
    },
    identify: function(callback) {
        lifx_remote.breatheEffect("id:"+ this.deviceId, 'green', null, 1, 3, false, true, 0.5, function (body) {
            callback();
        });
    },
    setLanColor: function(type, value, callback){
        var bulb = lifx_lan.bulbs[this.deviceId];

        this.log("Setting LAN color: " + type + " value: " + value);

        if (!bulb) {
            callback(new Error("Device not found"), false);
            return;
        }

        var state = {
            hue: bulb.state.hue,
            saturation: bulb.state.saturation,
            brightness: bulb.state.brightness,
            kelvin: 5500
        };

        var scale = {hue: 360, saturation: 100, brightness: 100, kelvin: 65535}[type];

        state[type] = Math.round(value * 65535 / scale) & 0xffff;
        lifx_lan.lightsColour(state.hue, state.saturation, state.brightness, state.kelvin, 0, bulb);

        callback(null);
    },
    setLanPower: function(state, callback){
        var bulb = lifx_lan.bulbs[this.deviceId];

        this.log("Setting LAN power: " + state);
        if (!bulb) {
            callback(new Error("Device not found"), false);
            return;
        }

        if (state) {
            lifx_lan.lightsOn(bulb);
        }
        else {
            lifx_lan.lightsOff(bulb);
        }

        callback(null);
    },
    setRemoteColor: function(type, value, callback){
        var color;

        this.log("Setting remote color: " + type + ", value: " + value);
        switch(type) {
            case "brightness":
                color = "brightness:" + (value / 100);
                break;
            case "hue":
                color = "hue:" + value;
                break;
            case "saturation":
                color = "saturation:" + (value / 100);
                break;
        }

        lifx_remote.setColor("id:"+ this.deviceId, color, 0, null, function (body) {
            callback();
        });
    },
    setRemotePower: function(state, callback){
        var that = this;

        this.log("Setting remote power: " + state);
        lifx_remote.setPower("id:"+ that.deviceId, (state == 1 ? "on" : "off"), 0, function (body) {
            callback();
        });
    },
    getServices: function() {
        var that = this;
        var services = []
        this.service = new Service.Lightbulb(this.name);

        switch(use_lan) {
            case true:
            case "true":
                // gets and sets over the lan api
                this.service.getCharacteristic(Characteristic.On)
                    .on('get', function(callback) { that.getLan("power", callback);})
                    .on('set', function(value, callback) {that.setLanPower(value, callback);});

                this.service.addCharacteristic(Characteristic.Brightness)
                    .on('get', function(callback) { that.getLan("brightness", callback);})
                    .on('set', function(value, callback) { that.setLanColor("brightness", value, callback);});

                if (this.capabilities.has_color == true) {
                    this.service.addCharacteristic(Characteristic.Hue)
                        .on('get', function(callback) { that.getLan("hue", callback);})
                        .on('set', function(value, callback) { that.setLanColor("hue", value, callback);});

                    this.service.addCharacteristic(Characteristic.Saturation)
                        .on('get', function(callback) { that.getLan("saturation", callback);})
                        .on('set', function(value, callback) { that.setLanColor("saturation", value, callback);});
                }
                break;
            case "get":
                // gets over the lan api, sets over the remote api
                this.service.getCharacteristic(Characteristic.On)
                    .on('get', function(callback) { that.getLan("power", callback);})
                    .on('set', function(value, callback) {that.setRemotePower(value, callback);});

                this.service.addCharacteristic(Characteristic.Brightness)
                    .on('get', function(callback) { that.getLan("brightness", callback);})
                    .on('set', function(value, callback) { that.setRemoteColor("brightness", value, callback);});

                if (this.capabilities.has_color == true) {
                    this.service.addCharacteristic(Characteristic.Hue)
                        .on('get', function(callback) { that.getLan("hue", callback);})
                        .on('set', function(value, callback) { that.setRemoteColor("hue", value, callback);});

                    this.service.addCharacteristic(Characteristic.Saturation)
                        .on('get', function(callback) { that.getLan("saturation", callback);})
                        .on('set', function(value, callback) { that.setRemoteColor("saturation", value, callback);});
                }
                break;
            default:
                // gets and sets over the remote api
                this.service.getCharacteristic(Characteristic.On)
                    .on('get', function(callback) { that.getRemote("power", callback);})
                    .on('set', function(value, callback) {that.setRemotePower(value, callback);});

                this.service.addCharacteristic(Characteristic.Brightness)
                    .on('get', function(callback) { that.getRemote("brightness", callback);})
                    .on('set', function(value, callback) { that.setRemoteColor("brightness", value, callback);});

                if (this.capabilities.has_color == true) {
                    this.service.addCharacteristic(Characteristic.Hue)
                        .on('get', function(callback) { that.getRemote("hue", callback);})
                        .on('set', function(value, callback) { that.setRemoteColor("hue", value, callback);});

                    this.service.addCharacteristic(Characteristic.Saturation)
                        .on('get', function(callback) { that.getRemote("saturation", callback);})
                        .on('set', function(value, callback) { that.setRemoteColor("saturation", value, callback);});
                }
        }

        services.push(this.service);

        var service = new Service.AccessoryInformation();

        service.setCharacteristic(Characteristic.Manufacturer, "LIFX")
            .setCharacteristic(Characteristic.Model, this.model)
            .setCharacteristic(Characteristic.SerialNumber, this.serial);

        services.push(service);

        return services;
    }
}

module.exports.accessory = LIFxBulbAccessory;
module.exports.platform = LIFxPlatform;

var Service, Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory("homebridge-lifx-bulb", "LIFxBulb", LIFxBulbAccessory);
  homebridge.registerPlatform("homebridge-lifx", "LIFx", LIFxPlatform);
};
