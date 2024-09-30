import axios from 'axios';
import { useEffect, useState, SetStateAction } from 'react';
import {
  Button,
  Box,
  Card,
  CardContent,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow
} from '@mui/material';
import { Refresh } from '@mui/icons-material';
import { Container } from '@mui/system';

const Connections = () => {
    const [allData, setAllData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        getExistingConnections();
      }, []);
    
    const getExistingConnections = async () => {
    const url = 'http://localhost:3003/api/connections';
    await axios
        .get(url)
        .then(function (response: { data }) {
        setAllData(response.data);
        setIsLoading(false);
        })
        .catch((error: any) => {
        setIsLoading(false);
        console.log('Error -- > ', error);
        });
    };

    if (allData.length < 1 && !isLoading) {
        return (
          <Card style={{ padding: '15px' }}>
            <div className="right-btn">
              <Button
                variant="contained"
                startIcon={<Refresh />}
                onClick={() => {
                    getExistingConnections();
                }}
              >
                Refresh
              </Button>
            </div>
            <h1>No data</h1>
          </Card>
        );
    } else {
        return (
            <div>
                <Container maxWidth='xl'>
                <Box
                    sx={{
                        width: '100%',
                        border: 1,
                        borderRadius: '5px',
                        borderWidth: 4,
                        borderColor: '#F1F3F4',
                        backgroundColor: '#E7EBEF'
                    }}
                >
                    <Card>
                        <h1 className="title">Existing Connections</h1>
                    <CardContent>
                        <TableContainer component={Paper}>
                            <Table sx={{ minWidth: 650 }} aria-label="simple table">
                                <TableHead sx={{ fontWeight: 'bold' }}>
                                    <TableRow sx={{ fontWeight: 'bold' }}>
                                    <TableCell align="right">Case Number</TableCell>
                                    <TableCell align="right">Patient First Name</TableCell>
                                    <TableCell align="right">Patient Last Name</TableCell>
                                    <TableCell align="right">Drug Name</TableCell>
                                    <TableCell align="right">Drug Code</TableCell>
                                    <TableCell align="right">Patient DOB</TableCell>
                                    <TableCell align="right">Status</TableCell>
                                    <TableCell align="right">Dispense Status</TableCell>
                                    <TableCell align="left">Authorization Number</TableCell>
                                    <TableCell align="right">Delete</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {allData.map(row => {
                                    return (
                                        <TableRow key={row.case_number}>
                                        <TableCell align="right">{row.case_number}</TableCell>
                                        <TableCell align="right">{row.patientFirstName}</TableCell>
                                        <TableCell align="right">{row.patientLastName}</TableCell>
                                        <TableCell align="right">{row.drugName}</TableCell>
                                        <TableCell align="right">{row.drugCode}</TableCell>
                                        <TableCell align="right">{row.patientDOB}</TableCell>
                                        <TableCell align="right">{row.status}</TableCell>
                                        <TableCell align="right">{row.dispenseStatus}</TableCell>
                                        <TableCell align="right">{row.auth_number}</TableCell>
                                        <TableCell align="right">
                                            {/* <IconButton
                                                aria-label="delete"
                                                onClick={(event: any) => deleteSingleRow(event, row)}
                                                >
                                                <DeleteIcon />
                                            </IconButton> */}
                                        </TableCell>
                                        </TableRow>
                                    );
                                    })}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </CardContent>
                    </Card>
                </Box>
                </Container>
            </div>
        )
    }
};

export default Connections;