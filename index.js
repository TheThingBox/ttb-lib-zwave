const OpenZwave = require('openzwave-shared');
const LibFlows = require('ttb-lib-flows');
const isUtf8 = require('is-utf8')

var ZWAVE = function(options = {}){
  this.zTopic = options.topic || 'zwave'
  this.zBroker = options.broker || 'MQTT.Localhost'
  this.devicePath = options.devicePath || "/dev/ttyACM0"
  this.skaleTagletHost = options.skaleTagletHost || "https://home-keeper.io/taglets"

  this.zConnected = false
  this.zNodes = []

  this.libFlows = new LibFlows(options.libFlows || {})
  this._zwave = new OpenZwave({
    SaveConfiguration: false,
    Logging: false,
    ConsoleOutput: false,
    SuppressValueRefresh: true
  });
}

ZWAVE.prototype.init = function(node){
  if(node.broker){
    this.zBroker = node.broker
  }
  if(node.topic){
    this.zTopic = node.topic
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
      this.zDriverReady(node, homeid)
    })

    this._zwave.on('driver failed', () => {
      this.zConnected = false
      this.zDriverFailed(node)
      rejected = true
      reject('driver failed')
    })

    this._zwave.on('node added', (nodeid) => {
      this.zNodeAdded(nodeid)
    })

    this._zwave.on('node ready', (nodeid, nodeinfo) => {
      this.zNodeReady(node, nodeid, nodeinfo)
    })

    this._zwave.on('value added', (nodeid, comclass, value) => {
      this.zValueAdded(node, nodeid, comclass, value)
    })

    this._zwave.on('value changed', (nodeid, comclass, value) => {
      this.zValueChanged(node, nodeid, comclass, value)
    })

    this._zwave.on('value removed', (nodeid, comclass, index) => {
      this.zValueRemoved(node, nodeid, comclass, index)
    })

    this._zwave.on('scene event', (nodeid, sceneid) => {
      this.zSceneEvent(node, nodeid, sceneid)
    })

    this._zwave.on('notification', (nodeid, notif) => {
      this.zNotification(node, nodeid, notif)
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
      if(added){
        resolve()
      } else {
        throw new Error('nodes not added')
      }
    })
    .catch(reject)
  })
}

ZWAVE.prototype.zNewDevice = function(nodeid, nodeinfo) {
  const manufacturerid = nodeinfo.manufacturerid.slice(2, nodeinfo.manufacturerid.length);
  const producttype = nodeinfo.producttype.slice(2, nodeinfo.producttype.length);
  const productid = nodeinfo.productid.slice(2, nodeinfo.productid.length);
  const productIDTotal = manufacturerid + "-" + producttype + "-" + productid;

  var node = {
    senderID: nodeid,
    nodeInfo: nodeinfo,
    productname: nodeinfo.manufacturer + " - " + nodeinfo.product
  };

  this.zFillNode(node, productIDTotal)
  this.zPrepareNode(node)

  this.prototype.addNewNode(node)
}

ZWAVE.prototype.zDumpNodes = function(){
  node.log("--- ZWave Dongle ---------------------");
  for(var i = 1; i < this.zNodes.length; i++) {
    if(this.zNodes[i] === null || typeof this.zNodes[i] === 'undefined'){
      node.log(`    node: [${i}] empty`);
      continue;
    }
    if(this.zNodes[i].hasOwnProperty("ready") && this.zNodes[i].ready === true) {
      node.log(`    node: [${i}] : ${nodes[i].toString()}`);
    } else {
      var alive=" ";
      if(Object.keys(nodes[i].classes).length > 1){
        alive = "alive but ";
      }
      node.log(`    node: [${i}] : ${alive}no infos yet`);
    }
  }
  node.log("--------------------------------------");
}

ZWAVE.prototype.zPrepareNode = function(node){
  if(node.commandclass !== undefined && node.classindex !== undefined && this.zNodes[nodeid].classes[node.commandclass] !== undefined && this.zNodes[nodeid].classes[node.commandclass][node.classindex] !== undefined) {
    node.classindexname = this.zNodes[nodeid].classes[node.commandclass][node.classindex].label;
  }

  node = {
    id: LibFlows.generateNodeID(),
    name: "",
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

  var taglet
  switch(node.typeNode) {
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

  if(taglet){
    node.extra.skale = `${this.skaleTagletHost}/com.daw.${taglet}.taglet`
  }
}

ZWAVE.prototype.zFillNode = function(node, productid){
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
      this._zwave.setConfigParam(node.senderID, 4, 1, 1);  // Enable PIR sensor
      this._zwave.setConfigParam(node.senderID, 5, 1, 1);  // Send PIR detection on binary sensor command class
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

ZWAVE.prototype.zDriverReady = function (node, homeid) {
  node.log('Driver ready');
  node.log('Scanning homeid=0x' + homeid.toString(16) + '...');
}

ZWAVE.prototype.zDriverFailed = function(node) {
  node.warn('Failed to start Z-wave driver');
}

ZWAVE.prototype.zNodeAdded = function(nodeid) {
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
    ready: false
  };
  this.zNodes[nodeid].prototype.toString = function(){
    return `${this.manufacturer} ${this.product} (${this.type} '${this.manufacturerid}-${this.producttype}-${this.productid}')`
  }
}

ZWAVE.prototype.zNodeReady = function(node, nodeid, nodeinfo) {
  this.zNodes[nodeid].manufacturer = nodeinfo.manufacturer;
  this.zNodes[nodeid].manufacturerid = nodeinfo.manufacturerid;
  this.zNodes[nodeid].product = nodeinfo.product;
  this.zNodes[nodeid].producttype = nodeinfo.producttype;
  this.zNodes[nodeid].productid = nodeinfo.productid;
  this.zNodes[nodeid].type = nodeinfo.type;
  this.zNodes[nodeid].name = nodeinfo.name;
  this.zNodes[nodeid].loc = nodeinfo.loc;
  this.zNodes[nodeid].ready = true;
  node.log(`node [${nodeid}] ready: ${this.zNodes[nodeid].toString()}`)

  if(nodeinfo.manufacturer && nodeinfo.product){
    if(nodeid !== 1) {
      this.zNewDevice(nodeid, nodeinfo);
    }

    for(var comclass in this.zNodes[nodeid].classes) {
      if(this.zNodes[nodeid].classes.hasOwnProperty(comclass) && [0x25, 0x26].indexOf(comclass) !== -1) {
        this._zwave.enablePoll(nodeid, comclass);
      }
    }

    this.zDumpNodes()
  }

  if(node.brokerConn) {
    node.brokerConn.publish({
      'qos': 0,
      'retain': false,
      'topic': `${this.zTopic}/nodeready/${nodeid}`,
      'payload': true
    });
  }
}

ZWAVE.prototype.zValueAdded = function(node, nodeid, comclass, value) {
  node.log(`node [${nodeid}] value added: comclass=${comclass}, value[${value.index}].${value.label}=${value.value}`)

  if(!this.zNodes[nodeid].classes[comclass]) {
    this.zNodes[nodeid].classes[comclass] = {};
  }

  this.zNodes[nodeid].classes[comclass][value.index] = value;

  if(node.brokerConn) {
    node.brokerConn.publish({
      'qos': 0,
      'retain': false,
      'topic': `${node.topic}/${nodeid}/${comclass}/${value.index}`,
      'payload': value.value
    });
  }
}

ZWAVE.prototype.zValueChanged = function(node, nodeid, comclass, value) {
  if(this.zNodes[nodeid].classes[comclass][value.index].value !== undefined && value.value !== this.zNodes[nodeid].classes[comclass][value.index].value) {
    this.zNodes[nodeid].classes[comclass][value.index] = value;

    if(node.brokerConn){
       node.brokerConn.publish({
        'qos': 0,
        'retain': false,
        'topic': `${node.topic}/${nodeid}/${comclass}/${value.index}`,
        'payload': value.value
      });
    }
  }
}

ZWAVE.prototype.zValueRemoved = function(node, nodeid, comclass, index) {
  node.log(`node [${nodeid}] value removed: comclass=${comclass}, value[${value.index}]`)

  if(this.zNodes[nodeid].classes[comclass] && this.zNodes[nodeid].classes[comclass][index]) {
    delete this.zNodes[nodeid].classes[comclass][index];
  }
}

ZWAVE.prototype.zSceneEvent = function(node, nodeid, sceneid) {
  node.log(`node [${nodeid}] scene event: sceneid=${sceneid}`)

  this.zNodes[nodeid].scene = sceneid;

  if(node.brokerConn){
    node.brokerConn.publish({
      'qos': 0,
      'retain': false,
      'topic': `${node.topic}/${nodeid}/scene`,
      'payload': sceneid
    });
  }
}

ZWAVE.prototype.zNotification = function(node, nodeid, notif) {
  switch(notif) {
    case 0:
      node.log(`node [${nodeid}] notification: message complete`)
      break;
    case 1:
      node.log(`node [${nodeid}] notification: timeout`)
      break;
    case 2:
      //node.log(`node [${nodeid}] notification: nop`)
      break;
    case 3:
      node.log(`node [${nodeid}] notification: node awake`)
      break;
    case 4:
      node.log(`node [${nodeid}] notification: node sleep`)
      break;
    case 5:
      node.log(`node [${nodeid}] notification: node dead`)
      break;
    case 6:
      node.log(`node [${nodeid}] notification: node alive`)
      break;
    default:
      //node.log(`node [${nodeid}] notification: unhandled notification`)
      break;
  }
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

ZWAVE.prototype.addNode = function(){
  if(this.zConnected){
    this._zwave.addNode()
  }
}

ZWAVE.prototype.setValue = function(nodeid, classe, a, b, c){
  if(this.zConnected){
    this._zwave.setValue(nodeid, classe, a, b, c)
  }
}

ZWAVE.prototype.removeAllListeners = function(){
  if(this._zwave){
    this._zwave.removeAllListeners()
  }
}

ZWAVE.COMCLASS_TO_HIDE = [50,94,112,115,132,134]

ZWAVE.comclassToShow = function(comclass) {
  if(COMCLASS_TO_HIDE.indexOf(comclass) !== -1) {
    return false
  }
  return true
}

var instance;
module.exports = function(options) {
  if(!instance) instance = new ZWAVE(options);
  return instance;
}
