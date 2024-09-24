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
import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { Refresh } from '@mui/icons-material';
import AddIcon from '@mui/icons-material/Add';
import { Container } from '@mui/system';
import Tooltip from '@mui/material/Tooltip';
import EditPopup from './EditPopup';

export type Connection = {
    code?: string;
    to?: string;
    toEtasu?: string;
    system?: string;
    from?: Array<String>;
    _id: string;
  };

const Connections = () => {
    const [allData, setAllData] = useState<Connection[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [openEdit, setOpenEdit] = useState(false);
    const [connection, setConnection] = useState<Connection | null>({code: '', to: '', toEtasu: '', from: [''], system: '', _id: ''});
    const [addNew, setAddNew] = useState(false);
    const [title, setTitle] = useState('Edit Connection');

    useEffect(() => {
        getExistingConnections();
      }, []);
    
    const getExistingConnections = async () => {
        const url = 'http://localhost:3003/api/connections';
        await axios
        .get(url)
        .then(function (response: { data: SetStateAction<Connection[]> }) {
            setAllData(response.data);
            setIsLoading(false);
        })
        .catch((error: any) => {
            setIsLoading(false);
            console.log('Error -- > ', error);
        });
    };

    const deleteConnection = async (event: any, row: Connection) => {
        console.log('row --- > ', row);
        // const url = 'http://localhost:3003/api/connections';
        // await axios
        // .get(url)
        // .then(function (response: { data }) {
        //     setAllData(response.data);
        //     console.log('response data -- > ', response.data);
        //     setIsLoading(false);
        // })
        // .catch((error: any) => {
        //     setIsLoading(false);
        //     console.log('Error -- > ', error);
        // });
    };

    const editConnection = (event: any, row: Connection) => {
        console.log('want to edit -- > ', row);
        setAddNew(false);
        setTitle('Edit Connection');
        setConnection(row);
        setOpenEdit(true);
    }

    const handleClose = () => {
        setOpenEdit(false);
    }

    const registerClient = (event: any, row: Connection) => {
        setConnection({code: '', to: '', toEtasu: '', from: '', system: ''});
        console.log('want to register client -- ');
        setAddNew(true);
        setTitle('Register Client');
        setOpenEdit(true);
    }

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
                        <div className="right-btn">
                            <Button
                                variant="contained"
                                startIcon={<AddIcon />}
                                onClick={() => {
                                    registerClient();
                                }}
                            >
                                Add
                            </Button>
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
                        <CardContent>
                            <TableContainer component={Paper}>
                                <Table sx={{ minWidth: 650 }} aria-label="simple table">
                                    <TableHead sx={{ fontWeight: 'bold' }}>
                                        <TableRow sx={{ fontWeight: 'bold' }}>
                                            <TableCell align="left">Code</TableCell>
                                            <TableCell align="left">To</TableCell>
                                            <TableCell align="left">Etasu</TableCell>
                                            <TableCell align="left">From</TableCell>
                                            <TableCell align="left">System</TableCell>
                                            <TableCell align="left">Actions</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {allData.map(row => {
                                        return (
                                            <TableRow key={row._id}>
                                            <TableCell align="left" className='btn-group'>{row.code}</TableCell>
                                            <TableCell align="left" className='btn-group'>{row.to}</TableCell>
                                            <TableCell align="left" className='btn-group'>{row.toEtasu}</TableCell>
                                            <TableCell align="left" className='btn-group'>{row.from}</TableCell>
                                            <TableCell align="left" className='btn-group'>{row.system}</TableCell>
                                            <TableCell align="left" className='btn-group'>
                                                <Tooltip title="Edit Connection" placement="top">
                                                    <IconButton
                                                        aria-label="edit"
                                                        onClick={(event: any) => editConnection(event, row)}
                                                        >
                                                        <EditIcon />
                                                    </IconButton>
                                                </Tooltip>
                                                <Tooltip title="Delete Connection" placement="top">
                                                    <IconButton
                                                        aria-label="delete"
                                                        onClick={(event: any) => deleteConnection(event, row)}
                                                        >
                                                        <DeleteIcon />
                                                    </IconButton>
                                                </Tooltip>
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
                <EditPopup open={openEdit} handleClose={handleClose} data={connection} addNew={addNew} title={title}/>
            </div>
        )
    }
};

export default Connections;