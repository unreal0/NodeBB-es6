var navigationAdmin = require('../../navigation/admin');
var SocketNavigation = module.exports;

SocketNavigation.save = (socket, data, callback) => {
	navigationAdmin.save(data, callback);
};
