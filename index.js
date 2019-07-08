const OpenZwave = require('openzwave-shared');
const LibFlows = require('ttb-lib-flows');
const EventEmitter = require('events').EventEmitter;
const isUtf8 = require('is-utf8')

var ZWAVE = function(options = {}){
  this.zTopic = options.topic || 'zwave'
  this.zBroker = options.broker || 'MQTT.Localhost'
  this.zMqtt = null
  this.devicePath = options.devicePath || "/dev/ttyACM0"
  this.skaleTagletHost = options.skaleTagletHost || "https://home-keeper.io/taglets"

  this.zConnected = false
  this.zNodes = []

  this.libFlows = new LibFlows(options.libFlows || {})

  /*
    Used options :
      | SaveConfiguration    | Bool    | When Shutting Down, should the library automatically save the Network Configuration in zwcfg_.xml_
      | Logging              | Bool    | Enable Logging in the Library or not.
      | ConsoleOutput        | Bool    | 	Enable log output to stdout (or console)
      | SuppressValueRefresh | Bool    | After a Value is Refreshed, should we send a notification to the application

    Options that should be used:
      | PollInterval         | Integer | How long we should spend polling the entire network, or how long between polls we should wait. (See IntervalBetweenPolls)
      |                                  The time period in milliseconds between polls of a nodes value. Be careful about using polling values below 30000 (30 seconds) as polling can flood the zwave network and cause problems. Default value: 60000
      | IntervalBetweenPolls | Bool    | Should the above value be how long to wait between polling the network devices, or how often all devices should be polled

    Other options : https://github.com/OpenZWave/open-zwave/wiki/Config-Options
  */
  this._zwave = new OpenZwave({
    SaveConfiguration: false,
    Logging: false,
    ConsoleOutput: false,
    SuppressValueRefresh: true
  });
}

ZWAVE.prototype = new EventEmitter()

ZWAVE.prototype.init = function(node){
  if(node.broker){
    this.zBroker = node.broker
  }
  if(node.topic){
    this.zTopic = node.topic
  }
  if(node.brokerConn){
    this.zMqtt = node.brokerConn
  }
  return new Promise( (resolve, reject) => {
    var rejected = false
    this._zwave.removeAllListeners()
    if(this.zConnected === true){
      this.zConnected = false
      try{
        this._zwave.disconnect(this.devicePath);
      } catch(e){}
    }

    this._zwave.on('driver ready', homeid => {
      this.zConnected = true
      this._driverReady(homeid)
      this.emit('driver ready', homeid)
    })

    this._zwave.on('driver failed', () => {
      this.zConnected = false
      this._driverFailed()
      rejected = true
      reject('driver failed')
    })

    this._zwave.on('node added', (nodeid) => {
      nodeid = ZWAVE.ensureNumber(nodeid)
      this._nodeAdded(nodeid)
      this.emit('node added', nodeid)
    })

    this._zwave.on('node ready', (nodeid, nodeinfo) => {
      nodeid = ZWAVE.ensureNumber(nodeid)
      this._nodeReady(nodeid, nodeinfo)
      this.emit('node added', nodeid, nodeinfo)
    })

    this._zwave.on('value added', (nodeid, comclass, value) => {
      nodeid = ZWAVE.ensureNumber(nodeid)
      this._valueAdded(nodeid, comclass, value)
      this.emit('value added', nodeid, comclass, value)
    })

    this._zwave.on('value changed', (nodeid, comclass, value) => {
      nodeid = ZWAVE.ensureNumber(nodeid)
      this._valueChanged(nodeid, comclass, value)
      this.emit('value changed', nodeid, comclass, value)
    })

    this._zwave.on('value removed', (nodeid, comclass, index) => {
      nodeid = ZWAVE.ensureNumber(nodeid)
      this._valueRemoved(nodeid, comclass, index)
      this.emit('value removed', nodeid, comclass, index)
    })

    this._zwave.on('scene event', (nodeid, sceneid) => {
      nodeid = ZWAVE.ensureNumber(nodeid)
      this._sceneEvent(nodeid, sceneid)
      this.emit('scene event', nodeid, sceneid)
    })

    this._zwave.on('notification', (nodeid, notif) => {
      nodeid = ZWAVE.ensureNumber(nodeid)
      this._notification(nodeid, notif)
      this.emit('notification', nodeid, notif)
    })

    this._zwave.on('scan complete', () => {
      if(!rejected){
        resolve()
      }
    })

    try{
      this._zwave.connect(this.devicePath)
    } catch(e){}

  })
}

ZWAVE.prototype.publish = function(topic, payload = "", qos = 0, retain = false){
  if(this.zMqtt){
    this.zMqtt.publish({
      qos: qos,
      retain: retain,
      topic: topic,
      payload: payload
    })
  }
}

ZWAVE.prototype.log = function(who, what, prefix, ...desc){
  let message = ''
  const haveWho = (who!== null && typeof who !== 'undefined')?true:false
  const haveWhat = (what!== null && typeof what !== 'undefined')?true:false
  const havePrefix = (prefix!== null && typeof prefix !== 'undefined')?true:false
  if(havePrefix){
    message = `${message}${prefix}`
  }
  if(haveWho){
    message = `${message}${(havePrefix===true)?' ':''}[zwave-node:${who}]`
  }
  message = `${message}${(haveWhat===true)?`${(haveWho===true)?' ':''}${what}`:''}${(desc.length===0)?'':' :'}`
  this.loger(message, ...desc)
}

ZWAVE.prototype.loger = function(...args){
  console.log(ZWAVE.timestamp(), '- [info]',...args)
}

ZWAVE.prototype.warn = function(...args){
  console.log(ZWAVE.timestamp(), '- [warn]',...args)
}

ZWAVE.prototype.addNewNode = function(nodes){
  return new Promise( (resolve, reject) => {
    this.libFlows.getFlowFromNode({"type": "zwave"})
    .then(flow => {
      if(flow){
        return this.libFlows.addToFlow(flow.id, flow.label, nodes, [], ['nodeid'])
      } else {
        throw new Error('You need to instantiate a zwave node')
      }
    })
    .then(added => {
      resolve()
    })
    .catch(reject)
  })
}

ZWAVE.prototype.comclassShowable = function(comclass) {
  if(ZWAVE.COMCLASS_TO_HIDE.indexOf(comclass) !== -1) {
    return false
  }
  return true
}

ZWAVE.prototype.getComclassToHide = function(){
  return ZWAVE.COMCLASS_TO_HIDE.slice()
}

ZWAVE.prototype._newDevice = function(nodeid, nodeinfo) {
  nodeid = ZWAVE.ensureNumber(nodeid)
  const manufacturerid = nodeinfo.manufacturerid.slice(2, nodeinfo.manufacturerid.length);
  const producttype = nodeinfo.producttype.slice(2, nodeinfo.producttype.length);
  const productid = nodeinfo.productid.slice(2, nodeinfo.productid.length);
  const productIDTotal = manufacturerid + "-" + producttype + "-" + productid;

  var node = {
    senderID: nodeid,
    nodeInfo: nodeinfo,
    productname: nodeinfo.manufacturer + " - " + nodeinfo.product
  };

  this._fillNode(node, productIDTotal)
  node = this._prepareNode(node)

  this.addNewNode(node)
}

ZWAVE.prototype._dumpNodes = function(){
  this.loger("--- ZWave Dongle ---------------------")
  for(var i = 1; i < this.zNodes.length; i++) {
    if(this.zNodes[i] === null || typeof this.zNodes[i] === 'undefined'){
      this.log(i, null, '   ', 'empty');
      continue;
    }
    if(this.zNodes[i].hasOwnProperty("ready") && this.zNodes[i].ready === true) {
      this.log(i, null, '   ', this.zNodes[i].toString())
    } else {
      var message="";
      if(Object.keys(this.zNodes[i].classes).length > 1){
        message = "alive but ";
      }
      message = `${message}no infos yet`
      this.log(i, null, '   ', message)
    }
  }
  this.loger("--------------------------------------");
}

ZWAVE.prototype._prepareNode = function(node){
  if(node && node.hasOwnProperty('senderID')){
    node.senderID = ZWAVE.ensureNumber(node.senderID)
  }
  if(node.commandclass !== undefined && node.classindex !== undefined && this.zNodes[node.senderID].classes[node.commandclass] !== undefined && this.zNodes[node.senderID].classes[node.commandclass][node.classindex] !== undefined) {
    node.classindexname = this.zNodes[node.senderID].classes[node.commandclass][node.classindex].label;
  }

  node = {
    id: this.libFlows.generateNodeID(),
    name: "",
    x: 270,
    productname: node.productname,
    classindexname: node.classindexname,
    nodeid: node.senderID,
    type: node.typeNode,
    typeNode: node.typeNode,
    commandclass: node.commandclass,
    classindex: node.classindex,
    nodeInfo: node.nodeInfo,
    mark: node.nodeInfo.manufacturer.toLowerCase().replace(/ /g, '') + ".png",
    extra: {
      StatusIn: `coldfacts/${this.zTopic}/${node.senderID}/in`,
    	StatusOut: `coldfacts/${this.zTopic}/${node.senderID}/out`,
    	DeviceType: node.nodeInfo.type,
      ui: true
    },
    wires: [[]]
  }
  if(node.typeNode.includes('remote') || node.typeNode.includes('motion')|| node.typeNode.includes('binary')){
    node.extra.StatusIn = undefined;
  }
  if(!node.typeNode.includes('subflow')){
    node.broker = this.zBroker
  }

  var taglet = ZWAVE.getTagletSkale(node.typeNode)

  if(taglet){
    node.extra.skale = `${this.skaleTagletHost}/com.daw.${taglet}.taglet`
  }
  return node
}

ZWAVE.prototype._fillNode = function(node, productid){
  if(node && node.hasOwnProperty('senderID')){
    node.senderID = ZWAVE.ensureNumber(node.senderID)
  }
  /*
    bool Manager::SetConfigParam	(
      uint32 const  _homeId,
      uint8 const   _nodeId,
      uint8 const   _param,
      int32         _value,
      uint8 const   _size = 2
    )
    Set the value of a configurable parameter in a device. Some devices have various parameters that can be configured to control the device behavior.
    These are not reported by the device over the Z-Wave network, but can usually be found in the device's user manual.
    This method returns immediately, without waiting for confirmation from the device that the change has been made.
    Parameters :
      _homeId  The Home ID of the Z-Wave controller that manages the node.
      _nodeId  The ID of the node to configure.
      _param   The index of the parameter.
      _value   The value to which the parameter should be set.
      _size    Is an optional number of bytes to be sent for the parameter _value. Defaults to 2.
    Returns :
      true if the a message setting the value was sent to the device.
  */
  switch (productid) {
    case "0086-0003-0062": // Aeotec, ZW098 LED Bulb
    case "0086-0103-0062": // Aeotec, ZW098 LED Bulb
    case "0086-0203-0062": // Aeotec, ZW098 LED Bulb
    case "0131-0002-0002": // Zipato, RGBW LED Bulb
      if(node.senderID !== undefined) {
        node.typeNode = "zwave-light-dimmer-switch"
      } else {
        node.type = "zwave-light-dimmer-switch"
      }
      node.commandclass = "38";
      node.classindex = "0";
      break;

    case "0165-0002-0002": // NodOn, CRC-3-6-0x Soft Remote
      if(node.senderID !== undefined) {
        node.typeNode = "nodonSoftRemote"
      } else {
        node.type = "nodonSoftRemote"
      }
      this._zwave.setConfigParam(node.senderID, 3, 1, 1); // Enable scene mode for the SoftRemote
      break;

    case "010f-0600-1000": // FIBARO System, FGWPE Wall Plug
    case "010f-0f01-1000": // FIBARO Button
    case "0165-0001-0001": // NodOn, ASP-3-1-00 Smart Plug
    case "0060-0004-0001": // AN157 Plug-in switch
    case "0060-0003-0003": // Everspring AD147 Plug-in Dimmer Module
      if(node.senderID !== undefined) {
        node.typeNode = "zwave-binary-switch"
      } else {
        node.type = "zwave-binary-switch"
      }
      node.commandclass = "37";
      node.classindex = "0";
      break;

    case "010f-0800-1001": // FIBARO System, FGMS001 Motion Sensor
    case "010f-0800-2001": // FIBARO System, FGMS001 Motion Sensor
    case "010f-0800-4001": // FIBARO System, FGMS001 Motion Sensor
    case "010f-0801-1001": // FIBARO System, FGMS001 Motion Sensor
    case "010f-0801-2001": // FIBARO System, FGMS001 Motion Sensor
      if(node.senderID !== undefined) {
        node.typeNode = "zwave-generic"
      } else {
        node.type = "zwave-generic"
      }
      node.commandclass = "48";
      node.classindex = "0";
      break;

    case "010f-0700-1000": // FIBARO System, FGK101 Door Opening Sensor
    case "010f-0700-2000": // FIBARO System, FGK101 Door Opening Sensor
    case "010f-0700-3000": // FIBARO System, FGK101 Door Opening Sensor
    case "010f-0700-4000": // FIBARO System, FGK101 Door Opening Sensor
      if(node.senderID !== undefined) {
        node.typeNode = "zwave-generic"
      } else {
        node.type = "zwave-generic"
      }
      node.commandclass = "48";
      node.classindex = "0";
      break;

    case "0086-0002-004a": // Aeotec, ZW074 MultiSensor Gen5
    case "0086-0102-004a": // Aeotec, ZW074 MultiSensor Gen5
    case "0086-0202-004a": // Aeotec, ZW074 MultiSensor Gen5
    case "0086-0002-0064": // Aeotec, ZW074 MultiSensor 6
    case "0086-0102-0064": // Aeotec, ZW074 MultiSensor 6
    case "0086-0202-0064": // Aeotec, ZW074 MultiSensor 6
      if(node.senderID !== undefined) {
        node.typeNode = "zwave-generic"
      } else {
        node.type = "zwave-generic"
      }
      node.commandclass = "48";
      node.classindex = "0";
      this._zwave.setConfigParam(node.senderID, 3, 30, 2); // Set the time(sec) that the PIR stay ON before sending OFF
      this._zwave.setConfigParam(node.senderID, 4, 1, 1);  // PIR sensitivity
      this._zwave.setConfigParam(node.senderID, 5, 1, 1);  // Send PIR detection on binary sensor command class
      break;
    case "0159-0002-0051": // ZWave Qubino Flush 2 Relay
      // NOT tested
      if(node.senderID !== undefined) {
        node.typeNode = "zwave-binary-switch"
      } else {
        node.type = "zwave-binary-switch"
      }
      node.commandclass = Object.keys(nodes[node.senderID].classes)[0];
      node.classindex = Object.keys(nodes[node.senderID].classes[node.commandclass])[0];
      break;
    default:
      console.log("Node " + node.senderID + " handled as generic. (productID:" +productid + ")");
      if(node.senderID !== undefined) {
        node.typeNode = "zwave-generic"
      } else {
        node.type = "zwave-generic"
      }
      node.commandclass = Object.keys(this.zNodes[node.senderID].classes)[0];
      node.classindex = Object.keys(this.zNodes[node.senderID].classes[node.commandclass])[0];
      break;
  }
}

ZWAVE.prototype._driverReady = function (homeid) {
  this.log('driver', ZWAVE.EVENTS.READY);
  this.log('1', ZWAVE.EVENTS.SCANNING, null, 'homeid=0x' + homeid.toString(16) + '...');
}

ZWAVE.prototype._driverFailed = function() {
  this.warn('Failed to start Z-wave driver');
}

ZWAVE.prototype._nodeAdded = function(nodeid) {
  nodeid = ZWAVE.ensureNumber(nodeid)
  this.zNodes[nodeid] = {
    manufacturer: '',
    manufacturerid: '',
    product: '',
    producttype: '',
    productid: '',
    type: '',
    name: '',
    loc: '',
    classes: {},
    ready: false,
    toString: function(){
      return `${this.manufacturer} ${this.product} (${this.type} '${this.manufacturerid}-${this.producttype}-${this.productid}')`
    }
  }
}

ZWAVE.prototype._nodeReady = function(nodeid, nodeinfo) {
  nodeid = ZWAVE.ensureNumber(nodeid)
  this.zNodes[nodeid].manufacturer = nodeinfo.manufacturer;
  this.zNodes[nodeid].manufacturerid = nodeinfo.manufacturerid;
  this.zNodes[nodeid].product = nodeinfo.product;
  this.zNodes[nodeid].producttype = nodeinfo.producttype;
  this.zNodes[nodeid].productid = nodeinfo.productid;
  this.zNodes[nodeid].type = nodeinfo.type;
  this.zNodes[nodeid].name = nodeinfo.name;
  this.zNodes[nodeid].loc = nodeinfo.loc;
  this.zNodes[nodeid].ready = true;
  this.log(nodeid, ZWAVE.EVENTS.READY, null, this.zNodes[nodeid].toString())

  if(nodeinfo.manufacturer && nodeinfo.product){
    if(nodeid !== 1) { // the 1 is the ZWave stick
      this._newDevice(nodeid, nodeinfo);
    }

    for(var comclass in this.zNodes[nodeid].classes) {
      if(this.zNodes[nodeid].classes.hasOwnProperty(comclass) && [0x25, 0x26].indexOf(comclass) !== -1) {
        this._zwave.enablePoll(nodeid, comclass);
      }
    }

    this._dumpNodes()
  }

  this.publish(`${this.zTopic}/nodeready/${nodeid}`, true)
}

ZWAVE.prototype._valueAdded = function(nodeid, comclass, value) {
  nodeid = ZWAVE.ensureNumber(nodeid)
  this.log(nodeid, ZWAVE.EVENTS.VALUE_ADDED, null, `comclass=${comclass}; value[${value.index}]['${value.label}']=${value.value}`)

  if(!this.zNodes[nodeid].classes[comclass]) {
    this.zNodes[nodeid].classes[comclass] = {};
  }

  this.zNodes[nodeid].classes[comclass][value.index] = value;

  this.publish(`${this.zTopic}/${nodeid}/${comclass}/${value.index}`, value.value)
}

ZWAVE.prototype._valueChanged = function(nodeid, comclass, value) {
  nodeid = ZWAVE.ensureNumber(nodeid)
  if(this.zNodes[nodeid].classes[comclass][value.index].value !== undefined && value.value !== this.zNodes[nodeid].classes[comclass][value.index].value) {
    this.zNodes[nodeid].classes[comclass][value.index] = value;

    this.publish(`${this.zTopic}/${nodeid}/${comclass}/${value.index}`, value.value)
  }
}

ZWAVE.prototype._valueRemoved = function(nodeid, comclass, index) {
  nodeid = ZWAVE.ensureNumber(nodeid)
  this.log(nodeid, ZWAVE.EVENTS.VALUE_REMOVED, null, `comclass=${comclass}, value[${index}]` )

  if(this.zNodes[nodeid].classes[comclass] && this.zNodes[nodeid].classes[comclass][index]) {
    delete this.zNodes[nodeid].classes[comclass][index];
  }
}

ZWAVE.prototype._sceneEvent = function(nodeid, sceneid) {
  nodeid = ZWAVE.ensureNumber(nodeid)
  this.log(nodeid, ZWAVE.EVENTS.SCENE, `sceneid=${sceneid}`)

  this.zNodes[nodeid].scene = sceneid;

  this.publish(`${this.zTopic}/${nodeid}/scene`, sceneid)
}

ZWAVE.prototype._notification = function(nodeid, notif) {
  nodeid = ZWAVE.ensureNumber(nodeid)
  switch(notif) {
    case 0:
      this.log(nodeid, ZWAVE.EVENTS.NOTIFICATION, 'message complete')
      break;
    case 1:
      this.log(nodeid, ZWAVE.EVENTS.NOTIFICATION, 'timeout')
      break;
    case 2:
      //this.log(nodeid, ZWAVE.EVENTS.NOTIFICATION, 'nop')
      break;
    case 3:
      this.log(nodeid, ZWAVE.EVENTS.NOTIFICATION, 'node awake')
      break;
    case 4:
      //this.log(nodeid, ZWAVE.EVENTS.NOTIFICATION, 'node sleep')
      break;
    case 5:
      this.log(nodeid, ZWAVE.EVENTS.NOTIFICATION, 'node dead')
      break;
    case 6:
      this.log(nodeid, ZWAVE.EVENTS.NOTIFICATION, 'node alive')
      break;
    default:
      //this.log(nodeid, ZWAVE.EVENTS.NOTIFICATION, 'unhandled notification')
      break;
  }
}

ZWAVE.prototype.addNode = function(){
  if(this.zConnected){
    this._zwave.addNode()
  }
}

ZWAVE.prototype.setValue = function(nodeid, classe, a, b, c){
  if(this.zConnected){
    nodeid = ZWAVE.ensureNumber(nodeid)
    this._zwave.setValue(nodeid, classe, a, b, c)
  }
}

ZWAVE.prototype.removeAllListeners = function(){
  if(this._zwave){
    this._zwave.removeAllListeners()
  }
}

ZWAVE.prototype.getPayloadFromMqtt = function(payload){
  return ZWAVE.getPayloadFromMqtt(payload)
}

ZWAVE.getTagletSkale = function(type){
  var taglet
  switch(type) {
    case "zwave-binary-switch":
      taglet = "switch";
      break;

    case "zwave-light-dimmer-switch":
      taglet = "light";
      break;

    case "zwave-remote-control-multi-purpose":
    case "nodonSoftRemote":
      taglet = "remote";
      break;

    case "zwave-motion-sensor":
    case "zwave-binary-sensor":
    case "aeotecMultiSensor":
      taglet = "motion";
      break;

    default:
        break;
  }
  return taglet
}

ZWAVE.getPayloadFromMqtt = function(payload){
  if(isUtf8(payload)) {
    payload = payload.toString();
  }
  try {
    payload = JSON.parse(payload);
  } catch (e) {}
  return payload
}

ZWAVE.COMCLASS_TO_HIDE = [50,94,112,115,132,134]

ZWAVE.MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

ZWAVE.EVENTS = {
  'VALUE_ADDED': 'value added',
  'NOTIFICATION': 'notification',
  'READY': 'ready',
  'SCANNING': 'scanning',
  'VALUE_REMOVED': 'value removed',
  'SCENE': 'scene event'
}

ZWAVE.pad = function(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}

ZWAVE.timestamp = function(){
  var d = new Date();
  var time = [ZWAVE.pad(d.getHours()), ZWAVE.pad(d.getMinutes()), ZWAVE.pad(d.getSeconds())].join(':');
  return [d.getDate(), ZWAVE.MONTHS[d.getMonth()], time].join(' ');
}

ZWAVE.ensureString = function(o){
  if(typeof o === 'undefined'){
    return o
  } else if (Buffer.isBuffer(o)) {
    return o.toString();
  } else if (typeof o === "object") {
    return JSON.stringify(o);
  } else if (typeof o === "string") {
    return o;
  }
  return ""+o;
}

ZWAVE.ensureNumber = function(o){
  if(typeof o === 'undefined'){
    return o
  }
  o = parseInt(o)
  if(isNaN(o)){
    return 0
  }
  return o
}

var instance;
module.exports = function(options) {
  if(!instance) instance = new ZWAVE(options);
  return instance;
}
