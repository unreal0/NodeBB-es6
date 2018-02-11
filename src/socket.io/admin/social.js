var social = require('../../social');
var SocketSocial = module.exports;

SocketSocial.savePostSharingNetworks = (socket, data, callback) => {
	social.setActivePostSharingNetworks(data, callback);
};
