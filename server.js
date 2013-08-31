//express is a light weight web framework similar to sinatra (ruby), and Nancy (.net)
//read more about express at: http://expressjs.com/
var express = require('express');

//underscore is a great little library that provides helpful functions for manipulating javascript
//objects. reard more about underscore at: http://underscorejs.org/
var _ = require('underscore');

//initialize express
var app = express();
var server = require('http').createServer(app);

//load all of our custom libraries (be sure to go through these files too)
var config = require('./lib/config');
var secret = require('./lib/secret');
var Twitter = require('./lib/twitter').Twitter;

//this is a node wrapper around redis, all the commands for
//redis are located here: http://redis.io/commands
var redis = require("redis");

//initialize an instance of our twitter api wrapper, look at lib/twitter.js for more
//information about how to extend this module
var twitter = new Twitter(secret);

//setup a redis client based on if the environment is development or production
var client = null;
if(process.env.REDISTOGO_URL) { //heroku
  client = require('redis-url').connect(process.env.REDISTOGO_URL); 
} else if(config.env == "development") {
  client = redis.createClient();
}  else { //nodejitsu
  client = redis.createClient(secret.redisPort, secret.redisMachine);
  client.auth(secret.redisAuth, function (err) {
     if (err) { throw err; }
  });
}

//setting some values for our express application
//ejs is a javascript rendering engine similar to erb (ruby) and aspx (.net)
//for more information on ejs, visit: http://embeddedjs.com/
app.set('view engine', 'ejs');
app.set('view options', { layout: false });

//all our public files (css, client side js files) are here
app.use('/public', express.static('public'));

//more express specific configurations
//best to visit the expressjs website for
//a thorough explanation
app.use(express.methodOverride());
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use(express.session({ secret: secret.consumerKey }));
app.use(app.router);

//catch all error handler
var error = function(res) {
  return function (err, response, body) {
    console.log("error: ", err);
    json(res, err);
  };
};

//helper method for writing out json payloads
var json = function(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });

  if(typeof data === "string") res.write(data);

  else res.write(JSON.stringify(data));

  res.end();
};

//helper method for display tweets in a
//format the client side can consume
var forDisplay = function(tweet) {
  return {
    id: tweet.id,
    id_str: tweet.id_str,
    text: tweet.text,
    links_in_text: tweet.entities.urls,
    user: { 
      name: tweet.user.name,
      screen_name: tweet.user.screen_name,
      profile_image_url: tweet.user.profile_image_url
    }
  };
};

//for those have have used rails or asp.net mvc, this
//is express's version of a before_filter (rails) or
//an ActionFilter (asp.net mvc)
//this filter verifies the authorization
function requiredAuthentication(req, res, next) {
  if(!secret.enableAuth) {
    next();
  } else if (req.session.passwordCorrect && req.session.mobileConfirmCorrect) {
    next();
  } else if (req.session.passwordCorrect) {
    res.redirect('/login2');
  } else {
    res.redirect('/login');
  }
}

//returns the env environment variable as a json
//payload
app.get('/env', function(req, res) {
  json(res, { env: config.env });
});

app.get('/login', function (req, res) {
  res.render('login');
});

//if the password matches what was specified
//in secret.js, generate a random 5 digit number
//and send a text message to the user via twilio
app.post('/login', function (req, res) {
  if(req.body.password === secret.password) {
    req.session.mobileConfirmation = Math.floor(Math.random() * 99999) + 10000;

    var client = require('twilio')(secret.twilioAccountSid, secret.twilioAuthToken);

    client.sendSms({
        to: secret.mobile,
        from: secret.twilioAssignedPhoneNumber,
        body: req.session.mobileConfirmation
    }, function(err, responseData) { 
    });

    req.session.passwordCorrect = true;
    res.redirect('/');
  } else {
    res.redirect('/login');
  }
});

app.get('/login2', function (req, res) {
  if (!req.session.passwordCorrect) {
    res.redirect('/login');
  } else {
    res.render('login2');
  }
});

//allow the user access to the site if the
//confirmation code matches what was stored in session
app.post('/login2', function (req, res) {
  if (!req.session.passwordCorrect) {
    res.redirect('/login');
  } else {
    if(req.body.code === req.session.mobileConfirmation.toString()) {
      req.session.mobileConfirmCorrect = true;
      res.redirect('/');
    } else {
      req.session.passwordCorrect = false;
      res.redirect('/login');
    }
  }
});

//main page (notice that all these interactions have the 
//requiredAuthentication filter specified
//if the user isn't authenticated, he will be directed
//to /login,
//this http/get renders the template in /views/index.ejs (go there for more information)
app.get('/', requiredAuthentication, function (req, res) {
  res.render('index');
});

//this http/get renders the template in /views/archived.ejs (go there for more information)
app.get('/favorites-archived', requiredAuthentication, function (req, res) {
  res.render('archived');
});

//this http/get renders the template in /views/sorted.ejs (go there for more information)
app.get('/favorites-sorted', requiredAuthentication, function (req, res) {
  res.render('sorted');
});

//this http/get renders the template in /views/export.ejs (go there for more information)
app.get('/export', requiredAuthentication, function(req, res) {
  res.render('export');
});

//this gets tagged stored in redis
//calling client.hgetall("tags") is the same has
//typing the following command in the redis client: hgetall tags
//for more infromation on redis commands, visit: http://redis.io/commands
app.get('/tags', requiredAuthentication, function(req, res) {
  client.hgetall("tags", function(error, data) {
    json(res, data);
  });
});

//retrieve the maximum number of favorites from twitter (which is 200)
//and return them as a json payload (passing the json through the
//forDisplay helper method)
app.get('/inbox', requiredAuthentication, function(req, res) {
  twitter.favorites({ count: 200 }, error(res), function(favorites) {
    var result = _.map(favorites, forDisplay);

    json(res, result);
  });
});

//retrieve all archived tweets stored in redis
app.get('/archived', requiredAuthentication, function(req, res) {
  client.hgetall("archived", function(err, data) {
    json(res, _.map(data, function(d) { return forDisplay(JSON.parse(d)); }));
  });
});

//retrieve all sorted tweets stored in redis
app.get('/sorted', requiredAuthentication, function(req, res) {
  client.hgetall("sorted", function(err, data) {
    json(res, _.map(data, function(d) { return forDisplay(JSON.parse(d)); }));
  });
});

//when a tweet is marked sorted, it is unfavorited from twitter
//and then stored in redis using client.hset method.
app.post('/markSorted', requiredAuthentication, function (req, res) {
  twitter.unfavorite({ }, { "id": req.body.id_str }, error(res), function(data) {
    client.hset('sorted', req.body.id_str, JSON.stringify(data));
    json(res, data);
  });
});

//when an import is requsted, the tweet is retrieved from twitter
//and stored in the sorted hashset, the tweet is also tagged as
//imported
app.post('/import', requiredAuthentication, function (req, res) {
  twitter.show(req.body.tweet_url, error(res), function(tweet) {
    if(tweet.statusCode != 404) {
      client.hset("sorted", tweet.id_str, JSON.stringify(tweet));
      client.hset("tags", tweet.id_str, "imported");
      var result = forDisplay(tweet);
      result.tags = "imported";
      json(res, result);
    } else {
      json(res, { statusCode: 404 });
    }
  });
});

//unfavorating a tweet is just unfavorited from twitter and then archived
//in redis
app.post('/unfavorite', requiredAuthentication, function (req, res) {
  twitter.unfavorite({ }, { "id": req.body.id_str }, error(res), function(data) {
    client.hset('archived', req.body.id_str, JSON.stringify(data));
    json(res, data);
  });
});

//marking a tweet archived means that it's removed from the sorted hash set
//and placed in the archived hash set. The client.hdel command is used
//to remove a hash entry.
app.post('/markArchived', requiredAuthentication, function (req, res) {
  client.hget("sorted", req.body.id_str, function(error, data) {
    if(data) {
      client.hdel("sorted", req.body.id_str);
      client.hset('archived', req.body.id_str, data);
    }

    json(res, { });
  });
});

//delete from redis
app.post('/markDeleted', requiredAuthentication, function(req, res) {
  client.hdel("archived", req.body.id_str, function(error, data) {
    json(res, { });
  });
});

//tags a tweet, simple string string hash
app.post('/tag', requiredAuthentication, function(req, res) {
  client.hset("tags", req.body.id_str, req.body.tags);

  json(res, { });
});

//shows a tweet as json unaltered, directly from the twitter wrapper
app.get('/api/show', requiredAuthentication, function(req, res) {
  twitter.show(req.query.tweet_url, error(res), function(tweet) {
    json(res, tweet);
  });
});

//all other get methods will attempt to call a method on the twitter
//wrapper and return the result as json
app.get('/api/:method', requiredAuthentication, function(req, res) {
  twitter[req.params.method](req.query, error(res), function(data) {
    json(res, data);
  });
});

server.listen(process.env.PORT || config.port);
