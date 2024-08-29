const express = require('express')
const path = require('path')
const sqlite3 = require('sqlite3')
const {open} = require('sqlite')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

const dbpath = path.join(__dirname, 'twitterClone.db')
let db = null

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    })

    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (error) {
    console.log(`DB Error :${error.message}`)
    process.exit(1)
  }
}

initializeDbAndServer()

const getFollowingPeopleId = async username => {
  const getFollowingPeopleIdQuery = `
      Select following_user_id From follower  Inner join user ON user.user_id = follower.follower_user_id
      Where user.username='${username}';
    `

  const followingPeople = await db.all(getFollowingPeopleIdQuery)
  const arrayOfId = followingPeople.map(each => each.following_user_id)
  return arrayOfId
}

const authentication = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader) {
    jwtToken = authHeader.split(' ')[1]
  }

  if (jwtToken) {
    jwt.verify(jwtToken, 'SECRET_KEY', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        request.userId = payload.userId
        next()
      }
    })
  } else {
    response.status(401)
    response.send('Invalid JWT Token')
  }
}

const tweetAccessVerification = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params
  const getTweetQuery = `
       Select * From tweet Inner join follower ON tweet.user_id=follower.following_user_id
       Where tweet.tweet_id='${tweetId}' AND follower_user_id='${userId}';
    `
  const tweet = await db.get(getTweetQuery)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const getUserQuery = `Select * From user Where username='${username}'`
  const userDBDetails = await db.get(getUserQuery)

  if (userDBDetails !== undefined) {
    response.status(400)
    response.send('User already exists')
  } else {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const createuserquery = `Insert into user(username,password,name,gender)
    Values('${username}','${hashedPassword}','${name}','${gender}')
    `
      await db.run(createuserquery)
      response.send('User created successfully')
    }
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body

  const getUserQuery = `Select * From user Where username='${username}';`
  const userDBDetails = await db.get(getUserQuery)

  if (userDBDetails !== undefined) {
    const isCorrect = await bcrypt.compare(password, userDBDetails.password)

    if (isCorrect) {
      const payload = {username, userId: userDBDetails.user_id}
      const jwtToken = jwt.sign(payload, 'SECRET_KEY')

      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  } else {
    response.status(400)
    response.send('Invalid user')
  }
})

app.get('/user/tweets/feed/', authentication, async (request, response) => {
  const {username} = request

  const followingPeopleId = await getFollowingPeopleId(username)

  const getTweetQuery = `Select username,tweet,date_time as dateTime
                       From user Inner Join tweet ON user.user_id=tweet.user_id
                       Where user.user_id IN (${followingPeopleId})
                       Order by date_time DESC
                       Limit 4 ;`

  const tweets = await db.all(getTweetQuery)
  response.send(tweets)
})

app.get('/user/following/', authentication, async (request, response) => {
  const {userId} = request
  const getFollowersQuery = `Select name From follower Inner Join user ON user.user_id=follower.following_user_id
                               Where follower_user_id='${userId}';`
  const followers = await db.all(getFollowersQuery)
  response.send(followers)
})

app.get('/user/followers/', authentication, async (request, response) => {
  const {username, userId} = request
  const getFollowersQuery = `Select Distinct name From follower Inner Join user ON user.user_id=follower.follower_user_id
                               Where following_user_id='${userId}';`
  const followers = await db.all(getFollowersQuery)
  response.send(followers)
})

app.get(
  '/tweets/:tweetId/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getTweetQuery = `Select tweet,
  (Select  Count()  From Like Where tweet_id='${tweetId}')As likes,
  (Select  Count()  From reply Where tweet_id='${tweetId}')As replies,
  date_time As dateTime

  From tweet

  Where tweet.tweet_id='${tweetId}';
  `

    const tweet = await db.get(getTweetQuery)
    response.send(tweet)
  },
)

app.get(
  '/tweets/:tweetId/likes/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getLikesQuery = `Select  username
  From user Inner Join like ON user.user_id=like.user_id
  Where tweet_id='${tweetId}';
  `
    const likeUsers = await db.all(getLikesQuery)
    const usersArray = likeUsers.map(each => each.username)
    response.send({likes: usersArray})
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getReplyQuery = `Select name,reply
  From user Inner Join reply ON user.user_id=reply.user_id
  Where tweet_id='${tweetId}';
  `
    const replyUsers = await db.all(getReplyQuery)
    response.send({replies: replyUsers})
  },
)

app.get('/user/tweets/', authentication, async (request, response) => {
  const {userId} = request

  const getTweetQuery = `Select tweet,
  Count (Distinct like_id) As likes,
  Count (Distinct reply_id) As replies,
  date_time As dateTime
  From tweet Left Join reply ON tweet.tweet_id=reply.tweet_id Left Join like ON tweet.tweet_id=like.tweet_id
  Where tweet.user_id =${userId}
  Group By tweet.tweet_id;
  `
  const tweets = await db.all(getTweetQuery)
  response.send(tweets)
})

app.post('/user/tweets/', authentication, async (request, response) => {
  const {tweet} = request.body
  const userId = parseInt(request.userId)
  const dateTime = new Date().toJSON().substring(0, 19).replace('T', ' ')
  const createTweetQuery = `Insert into tweet(tweet,user_id,date_time)
                            Values('${tweet}','${userId}', '${dateTime}')
  `
  await db.run(createTweetQuery)
  response.send('Created a Tweet')
})

app.delete('/tweets/:tweetId/', authentication, async (request, response) => {
  const {tweetId} = request.params
  const {userId} = request
  const getTheTweetQuery = `Select * From tweet Where user_id='${userId}' AND tweet_id='${tweetId}';`
  const tweet = await db.get(getTheTweetQuery)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    const deleteTweetQuery = `Delete From tweet Where tweet_id='${tweetId}';`
    await db.run(deleteTweetQuery)
    response.send('Tweet Removed')
  }
})

module.exports = app
