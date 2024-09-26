import { useState } from 'react'
import './App.css'
import { Button } from '@mui/material';
import Box from '@mui/material/Box';
import { Container } from '@mui/system';
import DatasetLinkedIcon from '@mui/icons-material/DatasetLinked';
import Login from './views/Login';
import Data from './views/DataViews/Data';

function App() {
  const [token, setToken] = useState(null);
  

  return (
    <Box>
      <div className="App">
        <Container maxWidth="false">
          <div className="containerg">
            <div className="logo">
              <DatasetLinkedIcon
                sx={{ color: 'white', fontSize: 40, paddingTop: 2.5, paddingRight: 2.5 }}
              />
              <h1>Rems Intermediary</h1>
            </div>
            {token ? (
              <div className="links">
                <Button variant="outlined" className="white-btn" onClick={() => setToken(null)}>
                  Logout
                </Button>
              </div>
            ) : (
              <span></span>
            )}
          </div>
        </Container>
      </div>
      {token ? <Data /> : <Login tokenCallback={setToken} />}
    </Box>
  )
}

export default App
